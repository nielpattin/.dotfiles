/*
 * MultiCodex (manual account switch)
 *
 * Purpose:
 * - Keep using built-in provider: openai-codex
 * - Manage multiple Codex OAuth accounts
 * - Manually switch active account via /multicodex-usage
 *
 * This extension DOES NOT register a custom provider and does NOT intercept streaming.
 */

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type TUI } from "@mariozechner/pi-tui";

interface CodexAuthTokens {
	id_token: string;
	access_token: string;
	refresh_token: string;
	account_id?: string;
}

interface CodexAuthPayload {
	auth_mode: "chatgpt";
	OPENAI_API_KEY: string | null;
	tokens: CodexAuthTokens;
	last_refresh: string | null;
}

interface StoredAccount {
	email: string;
	auth: CodexAuthPayload;
	lastUsed?: number;
}

interface LegacyStoredAccount {
	email: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	accountId?: string;
	lastUsed?: number;
}

interface StorageData {
	accounts: StoredAccount[];
	activeEmail?: string;
	codexActiveEmail?: string;
}

interface OAuthAuthEntry {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	[key: string]: unknown;
}

interface OpenAICodexCredentials extends OAuthCredentials {
	idToken?: string;
	accountId?: string;
}

interface TokenExchangeSuccess {
	type: "success";
	idToken?: string;
	access: string;
	refresh: string;
	expires: number;
}

interface TokenExchangeFailure {
	type: "failed";
}

type TokenExchangeResult = TokenExchangeSuccess | TokenExchangeFailure;

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const CODEX_DIR = path.join(os.homedir(), ".codex");
const STORAGE_FILE = path.join(AGENT_DIR, "multicodex.json");
const AUTH_FILE = path.join(AGENT_DIR, "auth.json");
const CODEX_AUTH_FILE = path.join(CODEX_DIR, "auth.json");
const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_CODEX_SCOPE = "openid profile email offline_access";
const OPENAI_CODEX_AUTH_CLAIM_PATH = "https://api.openai.com/auth";
const OPENAI_CODEX_PROFILE_CLAIM_PATH = "https://api.openai.com/profile";
const OAUTH_CALLBACK_POLL_ATTEMPTS = 600;
const OAUTH_CALLBACK_POLL_INTERVAL_MS = 100;
const USAGE_REQUEST_TIMEOUT_MS = 10_000;
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const USAGE_POLL_INTERVAL_MS = 60 * 1000;
const USAGE_STALE_THRESHOLD_MS = 15 * 60 * 1000;
const SWITCH_MIN_TOKEN_VALIDITY_MS = 2 * 60 * 1000;
const RATE_LIMIT_WARNING_THRESHOLDS = [75, 90, 95] as const;

interface AuthStorageLike {
	set(provider: string, credential: OAuthAuthEntry): void;
	get(provider: string): unknown;
	reload(): void;
}

interface CodexUsageWindow {
	usedPercent?: number;
	resetAt?: number;
}

interface CodexUsageSnapshot {
	primary?: CodexUsageWindow;
	secondary?: CodexUsageWindow;
	fetchedAt: number;
}

interface WhamUsageResponse {
	rate_limit?: {
		primary_window?: { used_percent?: number; reset_at?: number };
		secondary_window?: { used_percent?: number; reset_at?: number };
	};
}

function ensureAgentDir(): void {
	fs.mkdirSync(AGENT_DIR, { recursive: true });
}

function readJsonFile<T>(filePath: string): T | undefined {
	try {
		if (!fs.existsSync(filePath)) return undefined;
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
	} catch {
		return undefined;
	}
}

function writeJsonFile(filePath: string, data: unknown): void {
	const parent = path.dirname(filePath);
	fs.mkdirSync(parent, { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function normalizeStorage(raw: unknown): StorageData {
	if (!raw || typeof raw !== "object") {
		return { accounts: [] };
	}

	const input = raw as Partial<StorageData> & { accounts?: unknown[] };
	const accounts = Array.isArray(input.accounts) ? input.accounts : [];
	const normalized: StoredAccount[] = [];

	for (const item of accounts) {
		if (!item || typeof item !== "object") continue;
		const acc = item as Partial<StoredAccount> & Partial<LegacyStoredAccount>;
		if (typeof acc.email !== "string") continue;
		const auth = normalizeCodexAuthPayload(acc.auth);
		if (auth) {
			normalized.push({
				email: acc.email,
				auth,
				lastUsed: typeof acc.lastUsed === "number" ? acc.lastUsed : undefined,
			});
			continue;
		}
		if (
			typeof acc.accessToken === "string" &&
			typeof acc.refreshToken === "string" &&
			typeof acc.expiresAt === "number"
		) {
			normalized.push(
				legacyAccountToStoredAccount({
					email: acc.email,
					accessToken: acc.accessToken,
					refreshToken: acc.refreshToken,
					expiresAt: acc.expiresAt,
					accountId: typeof acc.accountId === "string" ? acc.accountId : undefined,
					lastUsed: typeof acc.lastUsed === "number" ? acc.lastUsed : undefined,
				}),
			);
		}
	}

	return {
		accounts: normalized,
		activeEmail: typeof input.activeEmail === "string" ? input.activeEmail : undefined,
		codexActiveEmail: typeof input.codexActiveEmail === "string" ? input.codexActiveEmail : undefined,
	};
}

function loadAuthData(): Record<string, unknown> {
	const parsed = readJsonFile<unknown>(AUTH_FILE);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {};
	}
	return parsed as Record<string, unknown>;
}

function loadCodexAuthData(): CodexAuthPayload | undefined {
	return normalizeCodexAuthPayload(readJsonFile<unknown>(CODEX_AUTH_FILE));
}

function parseOAuthAuthEntry(value: unknown): OAuthAuthEntry | undefined {
	if (!value || typeof value !== "object") return undefined;
	const entry = value as Partial<OAuthAuthEntry>;
	if (
		entry.type !== "oauth" ||
		typeof entry.access !== "string" ||
		typeof entry.refresh !== "string" ||
		typeof entry.expires !== "number"
	) {
		return undefined;
	}
	return entry as OAuthAuthEntry;
}

function extractOpenAICodexAuth(auth: Record<string, unknown>): OAuthAuthEntry | undefined {
	return parseOAuthAuthEntry(auth[OPENAI_CODEX_PROVIDER]);
}

function parseJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	const payload = parts[1];
	if (!payload) return undefined;
	try {
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padLength = (4 - (normalized.length % 4)) % 4;
		const decoded = Buffer.from(`${normalized}${"=".repeat(padLength)}`, "base64").toString("utf8");
		const parsed = JSON.parse(decoded);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function getJwtAccountId(token: string): string | undefined {
	const payload = parseJwtPayload(token);
	const auth = payload?.[OPENAI_CODEX_AUTH_CLAIM_PATH];
	if (!auth || typeof auth !== "object" || Array.isArray(auth)) return undefined;
	const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
}

function getJwtEmail(token: string): string | undefined {
	const payload = parseJwtPayload(token);
	const directEmail = payload?.email;
	if (typeof directEmail === "string" && directEmail.length > 0) return directEmail;
	const profile = payload?.[OPENAI_CODEX_PROFILE_CLAIM_PATH];
	if (!profile || typeof profile !== "object" || Array.isArray(profile)) return undefined;
	const profileEmail = (profile as Record<string, unknown>).email;
	return typeof profileEmail === "string" && profileEmail.length > 0 ? profileEmail : undefined;
}

function getJwtExpiry(token: string): number | undefined {
	const payload = parseJwtPayload(token);
	const exp = payload?.exp;
	return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
}

function normalizeLastRefresh(value: unknown): string | null {
	return typeof value === "string" || value === null ? value : null;
}

function normalizeCodexAuthPayload(value: unknown): CodexAuthPayload | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const input = value as Partial<CodexAuthPayload> & {
		tokens?: Partial<CodexAuthTokens>;
	};
	const tokens = input.tokens;
	if (
		input.auth_mode !== "chatgpt" ||
		(typeof input.OPENAI_API_KEY !== "string" && input.OPENAI_API_KEY !== null) ||
		!tokens ||
		typeof tokens.id_token !== "string" ||
		typeof tokens.access_token !== "string" ||
		typeof tokens.refresh_token !== "string"
	) {
		return undefined;
	}
	return {
		auth_mode: "chatgpt",
		OPENAI_API_KEY: input.OPENAI_API_KEY ?? null,
		tokens: {
			id_token: tokens.id_token,
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			account_id: typeof tokens.account_id === "string" ? tokens.account_id : undefined,
		},
		last_refresh: normalizeLastRefresh(input.last_refresh),
	};
}

function createCodexAuthPayload(params: {
	idToken: string;
	accessToken: string;
	refreshToken: string;
	accountId?: string;
	lastRefresh?: string | null;
}): CodexAuthPayload {
	const accountId = params.accountId ?? getJwtAccountId(params.accessToken) ?? getJwtAccountId(params.idToken);
	return {
		auth_mode: "chatgpt",
		OPENAI_API_KEY: null,
		tokens: {
			id_token: params.idToken,
			access_token: params.accessToken,
			refresh_token: params.refreshToken,
			...(accountId ? { account_id: accountId } : {}),
		},
		last_refresh: params.lastRefresh ?? new Date().toISOString(),
	};
}

function legacyAccountToStoredAccount(account: LegacyStoredAccount): StoredAccount {
	return {
		email: account.email,
		auth: createCodexAuthPayload({
			idToken: account.accessToken,
			accessToken: account.accessToken,
			refreshToken: account.refreshToken,
			accountId: account.accountId,
			lastRefresh: new Date().toISOString(),
		}),
		lastUsed: account.lastUsed,
	};
}

function getStoredAccessToken(account: StoredAccount): string {
	return account.auth.tokens.access_token;
}

function getStoredRefreshToken(account: StoredAccount): string {
	return account.auth.tokens.refresh_token;
}

function getStoredAccountId(account: StoredAccount): string | undefined {
	return account.auth.tokens.account_id ?? getJwtAccountId(account.auth.tokens.access_token);
}

function getStoredExpiresAt(account: StoredAccount): number | undefined {
	return getJwtExpiry(account.auth.tokens.access_token);
}

function createOAuthAuthEntry(account: StoredAccount): OAuthAuthEntry {
	return {
		type: "oauth",
		access: getStoredAccessToken(account),
		refresh: getStoredRefreshToken(account),
		expires: getStoredExpiresAt(account) ?? Date.now(),
		...(getStoredAccountId(account) ? { accountId: getStoredAccountId(account) } : {}),
	};
}

function areCodexAuthPayloadsEqual(a?: CodexAuthPayload, b?: CodexAuthPayload): boolean {
	if (!a || !b) return false;
	return (
		a.auth_mode === b.auth_mode &&
		a.OPENAI_API_KEY === b.OPENAI_API_KEY &&
		a.last_refresh === b.last_refresh &&
		a.tokens.id_token === b.tokens.id_token &&
		a.tokens.access_token === b.tokens.access_token &&
		a.tokens.refresh_token === b.tokens.refresh_token &&
		a.tokens.account_id === b.tokens.account_id
	);
}

function base64UrlEncode(input: Buffer): string {
	return input
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function createPkceCodes(): { verifier: string; challenge: string } {
	const verifier = base64UrlEncode(randomBytes(32));
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

function createOAuthState(): string {
	return randomBytes(16).toString("hex");
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};
	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {
		// Not a URL.
	}
	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return { code, state };
	}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
		};
	}
	return { code: value };
}

function createAuthorizationFlow(originator = "pi"): { verifier: string; state: string; url: string } {
	const { verifier, challenge } = createPkceCodes();
	const state = createOAuthState();
	const url = new URL(OPENAI_CODEX_AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", OPENAI_CODEX_CLIENT_ID);
	url.searchParams.set("redirect_uri", OPENAI_CODEX_REDIRECT_URI);
	url.searchParams.set("scope", OPENAI_CODEX_SCOPE);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", originator);
	return { verifier, state, url: url.toString() };
}

async function exchangeAuthorizationCode(code: string, verifier: string): Promise<TokenExchangeResult> {
	const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: OPENAI_CODEX_CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: OPENAI_CODEX_REDIRECT_URI,
		}),
	});
	if (!response.ok) return { type: "failed" };
	const json = (await response.json()) as Record<string, unknown>;
	if (
		typeof json.access_token !== "string" ||
		typeof json.refresh_token !== "string" ||
		typeof json.expires_in !== "number"
	) {
		return { type: "failed" };
	}
	return {
		type: "success",
		idToken: typeof json.id_token === "string" ? json.id_token : undefined,
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
	};
}

async function refreshOpenAICodexAuth(refreshToken: string): Promise<OpenAICodexCredentials> {
	const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: OPENAI_CODEX_CLIENT_ID,
		}),
	});
	if (!response.ok) {
		throw new Error("Failed to refresh OpenAI Codex token");
	}
	const json = (await response.json()) as Record<string, unknown>;
	if (
		typeof json.access_token !== "string" ||
		typeof json.refresh_token !== "string" ||
		typeof json.expires_in !== "number"
	) {
		throw new Error("Failed to refresh OpenAI Codex token");
	}
	const accountId = getJwtAccountId(json.access_token);
	if (!accountId) {
		throw new Error("Failed to extract accountId from token");
	}
	return {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
		accountId,
		...(typeof json.id_token === "string" ? { idToken: json.id_token } : {}),
	};
}

async function loginOpenAICodexWithIdToken(options: {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>;
	originator?: string;
}): Promise<OpenAICodexCredentials> {
	const { verifier, state, url } = createAuthorizationFlow(options.originator);
	let lastCode: string | undefined;
	let cancelled = false;
	let serverListening = false;
	const server = createServer((req, res) => {
		try {
			const requestUrl = new URL(req.url || "", "http://localhost");
			if (requestUrl.pathname !== "/auth/callback") {
				res.statusCode = 404;
				res.end("Not found");
				return;
			}
			if (requestUrl.searchParams.get("state") !== state) {
				res.statusCode = 400;
				res.end("State mismatch");
				return;
			}
			const code = requestUrl.searchParams.get("code");
			if (!code) {
				res.statusCode = 400;
				res.end("Missing authorization code");
				return;
			}
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end("<!doctype html><html><body><p>Authentication successful. Return to your terminal to continue.</p></body></html>");
			lastCode = code;
		} catch {
			res.statusCode = 500;
			res.end("Internal error");
		}
	});

	await new Promise<void>((resolve) => {
		server.listen(1455, "127.0.0.1", () => {
			serverListening = true;
			resolve();
		});
		server.on("error", () => {
			cancelled = true;
			resolve();
		});
	});

	options.onAuth({ url, instructions: "A browser window should open. Complete login to finish." });
	try {
		let code: string | undefined;
		if (!cancelled) {
			for (let i = 0; i < OAUTH_CALLBACK_POLL_ATTEMPTS; i += 1) {
				if (lastCode) {
					code = lastCode;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, OAUTH_CALLBACK_POLL_INTERVAL_MS));
			}
		}
		if (!code) {
			const input = await options.onPrompt({
				message: "Paste the authorization code (or full redirect URL):",
			});
			const parsed = parseAuthorizationInput(input);
			if (parsed.state && parsed.state !== state) {
				throw new Error("State mismatch");
			}
			code = parsed.code;
		}
		if (!code) {
			throw new Error("Missing authorization code");
		}
		const tokenResult = await exchangeAuthorizationCode(code, verifier);
		if (tokenResult.type !== "success") {
			throw new Error("Token exchange failed");
		}
		const accountId = getJwtAccountId(tokenResult.access);
		if (!accountId) {
			throw new Error("Failed to extract accountId from token");
		}
		return {
			access: tokenResult.access,
			refresh: tokenResult.refresh,
			expires: tokenResult.expires,
			accountId,
			...(tokenResult.idToken ? { idToken: tokenResult.idToken } : {}),
		};
	} finally {
		if (serverListening) {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	}
}

function getAuthStorage(ctx?: ExtensionContext): AuthStorageLike | undefined {
	const candidate = (ctx?.modelRegistry as { authStorage?: unknown } | undefined)?.authStorage;
	if (!candidate || typeof candidate !== "object") return undefined;
	const authStorage = candidate as Partial<AuthStorageLike>;
	if (
		typeof authStorage.set !== "function" ||
		typeof authStorage.get !== "function" ||
		typeof authStorage.reload !== "function"
	) {
		return undefined;
	}
	return authStorage as AuthStorageLike;
}

function normalizeUsedPercent(value?: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.min(100, Math.max(0, value));
}

function normalizeResetAt(value?: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return value * 1000;
}

function parseUsageWindow(window?: { used_percent?: number; reset_at?: number }): CodexUsageWindow | undefined {
	if (!window) return undefined;
	const usedPercent = normalizeUsedPercent(window.used_percent);
	const resetAt = normalizeResetAt(window.reset_at);
	if (usedPercent === undefined && resetAt === undefined) return undefined;
	return { usedPercent, resetAt };
}

function parseUsageResponse(data: WhamUsageResponse): Omit<CodexUsageSnapshot, "fetchedAt"> {
	return {
		primary: parseUsageWindow(data.rate_limit?.primary_window),
		secondary: parseUsageWindow(data.rate_limit?.secondary_window),
	};
}

function getRemainingPercent(usedPercent?: number): number | undefined {
	if (usedPercent === undefined) return undefined;
	return Math.max(0, 100 - usedPercent);
}

function formatRemainingPercent(usedPercent?: number): string {
	const remainingPercent = getRemainingPercent(usedPercent);
	if (remainingPercent === undefined) return "unknown";
	return `${Math.round(remainingPercent)}% left`;
}

function isUsageStale(usage?: CodexUsageSnapshot): boolean {
	if (!usage) return false;
	return Date.now() - usage.fetchedAt > USAGE_STALE_THRESHOLD_MS;
}

function formatCompactResetAt(resetAt?: number): string {
	if (!resetAt) return "?";
	const diffMs = resetAt - Date.now();
	if (diffMs <= 0) return "now";
	const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
	if (diffMinutes < 60) return `${diffMinutes}m`;
	const diffHours = Math.round(diffMinutes / 60);
	if (diffHours < 48) return `${diffHours}h`;
	const diffDays = Math.round(diffHours / 24);
	return `${diffDays}d`;
}

function formatWindowStatus(label: string, window?: CodexUsageWindow): string {
	return `${label} ${formatRemainingPercent(window?.usedPercent)} r:${formatCompactResetAt(window?.resetAt)}`;
}

function formatStatusSummary(usage?: CodexUsageSnapshot): string {
	const primaryLabel = formatRemainingPercent(usage?.primary?.usedPercent);
	const secondaryLabel = formatRemainingPercent(usage?.secondary?.usedPercent);
	const staleSuffix = isUsageStale(usage) ? " | stale" : "";
	return `MC 5h ${primaryLabel} | 1w ${secondaryLabel}${staleSuffix}`;
}

class RateLimitWarningState {
	private thresholdState = new Map<string, number>();

	takeWarnings(accountEmail: string, usage?: CodexUsageSnapshot): string[] {
		if (!usage) return [];
		const warnings = [
			this.takeWindowWarning(accountEmail, "1w", usage.secondary?.usedPercent),
			this.takeWindowWarning(accountEmail, "5h", usage.primary?.usedPercent),
		].filter((warning): warning is string => typeof warning === "string");
		return warnings;
	}

	private takeWindowWarning(accountEmail: string, windowLabel: string, usedPercent?: number): string | undefined {
		const key = `${accountEmail}:${windowLabel}`;
		if (usedPercent === undefined) {
			this.thresholdState.delete(key);
			return undefined;
		}
		if (usedPercent >= 100) {
			return undefined;
		}

		let highestIndex = -1;
		for (let i = 0; i < RATE_LIMIT_WARNING_THRESHOLDS.length; i += 1) {
			const threshold = RATE_LIMIT_WARNING_THRESHOLDS[i];
			if (threshold !== undefined && usedPercent >= threshold) highestIndex = i;
		}

		const previousIndex = this.thresholdState.get(key) ?? -1;
		this.thresholdState.set(key, highestIndex);
		if (highestIndex <= previousIndex) return undefined;

		const threshold = RATE_LIMIT_WARNING_THRESHOLDS[highestIndex];
		if (threshold === undefined) return undefined;
		const remainingPercent = 100 - threshold;
		return `Heads up: ${accountEmail} has less than ${remainingPercent}% of the ${windowLabel} limit left. Run /multicodex-usage for details.`;
	}
}

interface UsagePanelRowState {
	account: StoredAccount;
	usage?: CodexUsageSnapshot;
	loading: boolean;
	error?: string;
}

function formatAccountTags(parts: Array<string | null | undefined>): string {
	const tags = parts.filter(Boolean).join(", ");
	return tags ? ` (${tags})` : "";
}

class MultiCodexUsageOverlay {
	private rows: UsagePanelRowState[];
	private selectedIndex = 0;
	private busyEmail?: string;
	private busyTarget?: "pi" | "codex";
	private disposed = false;
	private refreshRequestId = 0;
	private piActiveEmail?: string;
	private codexActiveEmail?: string;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		accounts: StoredAccount[],
		piActiveEmail: string | undefined,
		codexActiveEmail: string | undefined,
		private readonly isPiAuthSynced: (email: string) => boolean,
		private readonly isCodexAuthSynced: (email: string) => boolean,
		private readonly loadUsage: (account: StoredAccount, force?: boolean) => Promise<CodexUsageSnapshot | undefined>,
		private readonly syncPiAccount: (email: string) => Promise<boolean>,
		private readonly syncCodexAccount: (email: string) => Promise<boolean>,
		private readonly done: () => void,
	) {
		this.rows = accounts.map((account) => ({
			account,
			loading: true,
		}));
		this.piActiveEmail = piActiveEmail;
		this.codexActiveEmail = codexActiveEmail;
		const activeIndex = accounts.findIndex((account) => account.email === piActiveEmail || account.email === codexActiveEmail);
		this.selectedIndex = activeIndex >= 0 ? activeIndex : 0;
	}

	start(): void {
		void this.refreshAll(true);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.refresh();
			return;
		}
		if (matchesKey(data, "down")) {
			this.selectedIndex = Math.min(this.rows.length - 1, this.selectedIndex + 1);
			this.refresh();
			return;
		}
		if (matchesKey(data, "r")) {
			void this.refreshAll(true);
			return;
		}
		if (matchesKey(data, "return")) {
			void this.activateSelectedPi();
			return;
		}
		if (matchesKey(data, "s")) {
			void this.activateSelectedCodex();
		}
	}

	render(width: number): string[] {
		const w = Math.max(60, Math.min(width, 100));
		const innerW = Math.max(0, w - 2);
		const th = this.theme;
		const lines: string[] = [];

		const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - visibleWidth(s)));
		const row = (content = "") =>
			th.fg("border", "│") + pad(truncateToWidth(content, innerW), innerW) + th.fg("border", "│");

		lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
		lines.push(row(` ${th.fg("accent", th.bold("MultiCodex Usage"))}`));
		lines.push(row(` ${th.fg("dim", "Enter sync Pi • s sync Codex • r refresh • Esc close")}`));
		lines.push(row());

		for (let i = 0; i < this.rows.length; i += 1) {
			const item = this.rows[i]!;
			const isSelected = i === this.selectedIndex;
			const isPiActive = this.piActiveEmail === item.account.email;
			const isCodexActive = this.codexActiveEmail === item.account.email;
			const prefix = isSelected ? th.fg("accent", "▶") : th.fg("dim", "•");
			const labelTags = formatAccountTags([
				isPiActive ? "pi-active" : null,
				isCodexActive ? "codex-active" : null,
				this.isPiAuthSynced(item.account.email) ? "pi-synced" : null,
				this.isCodexAuthSynced(item.account.email) ? "codex-synced" : null,
				this.busyEmail === item.account.email && this.busyTarget === "pi" ? "syncing-pi" : null,
				this.busyEmail === item.account.email && this.busyTarget === "codex" ? "syncing-codex" : null,
				isUsageStale(item.usage) ? "stale" : null,
			]);
			const email = isSelected ? th.fg("accent", item.account.email) : item.account.email;
			lines.push(row(` ${prefix} ${email}${labelTags}`));

			let detail = "   loading usage...";
			if (item.error) {
				detail = `   ${th.fg("warning", item.error)}`;
			} else if (!item.loading) {
				detail = `   ${formatWindowStatus("5h", item.usage?.primary)} | ${formatWindowStatus("1w", item.usage?.secondary)}`;
			}
			lines.push(row(detail));
			if (i < this.rows.length - 1) lines.push(row(` ${th.fg("borderMuted", "─".repeat(Math.max(0, innerW - 1)))}`));
		}

		lines.push(row());
		lines.push(row(` ${th.fg("dim", "Tip: this panel opens instantly, then loads usage in background.")}`));
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));
		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		this.disposed = true;
	}

	private refresh(): void {
		if (this.disposed) return;
		this.tui.requestRender();
	}

	private async refreshAll(force: boolean): Promise<void> {
		const requestId = ++this.refreshRequestId;
		for (const row of this.rows) {
			row.loading = true;
			row.error = undefined;
		}
		this.refresh();

		await Promise.all(
			this.rows.map(async (row) => {
				const usage = await this.loadUsage(row.account, force);
				if (this.disposed || requestId !== this.refreshRequestId) return;
				row.usage = usage;
				row.loading = false;
				row.error = usage ? undefined : "usage unavailable";
				this.refresh();
			}),
		);
	}

	private async activateSelectedPi(): Promise<void> {
		const selected = this.rows[this.selectedIndex];
		if (!selected || this.busyEmail) return;
		this.busyEmail = selected.account.email;
		this.busyTarget = "pi";
		this.refresh();
		const ok = await this.syncPiAccount(selected.account.email);
		if (this.disposed) return;
		if (ok) {
			this.piActiveEmail = selected.account.email;
		}
		this.busyEmail = undefined;
		this.busyTarget = undefined;
		this.refresh();
	}

	private async activateSelectedCodex(): Promise<void> {
		const selected = this.rows[this.selectedIndex];
		if (!selected || this.busyEmail) return;
		this.busyEmail = selected.account.email;
		this.busyTarget = "codex";
		this.refresh();
		const ok = await this.syncCodexAccount(selected.account.email);
		if (this.disposed) return;
		if (ok) {
			this.codexActiveEmail = selected.account.email;
		}
		this.busyEmail = undefined;
		this.busyTarget = undefined;
		this.refresh();
	}
}

class ManualAccountManager {
	private data: StorageData;
	private usageCache = new Map<string, CodexUsageSnapshot>();

	constructor() {
		this.data = normalizeStorage(readJsonFile<unknown>(STORAGE_FILE));
	}

	private save(): void {
		writeJsonFile(STORAGE_FILE, this.data);
	}

	getAccounts(): StoredAccount[] {
		return this.data.accounts;
	}

	getAccount(email: string): StoredAccount | undefined {
		return this.data.accounts.find((a) => a.email === email);
	}

	getActiveAccount(): StoredAccount | undefined {
		if (this.data.activeEmail) {
			return this.getAccount(this.data.activeEmail);
		}
		return this.data.accounts[0];
	}

	getCodexActiveAccount(): StoredAccount | undefined {
		if (this.data.codexActiveEmail) {
			return this.getAccount(this.data.codexActiveEmail);
		}
		return undefined;
	}

	setActiveAccount(email: string): void {
		const account = this.getAccount(email);
		if (!account) return;
		account.lastUsed = Date.now();
		this.data.activeEmail = account.email;
		this.save();
	}

	setCodexActiveAccount(email: string): void {
		const account = this.getAccount(email);
		if (!account) return;
		account.lastUsed = Date.now();
		this.data.codexActiveEmail = account.email;
		this.save();
	}

	addOrUpdateAccount(
		email: string,
		creds: OpenAICodexCredentials,
		options?: { setActive?: boolean; touchLastUsed?: boolean },
	): void {
		const setActive = options?.setActive ?? true;
		const touchLastUsed = options?.touchLastUsed ?? true;
		const now = Date.now();
		const existing = this.getAccount(email);
		const previousIdToken = existing?.auth.tokens.id_token;
		const auth = createCodexAuthPayload({
			idToken:
				typeof creds.idToken === "string" && creds.idToken.length > 0
					? creds.idToken
					: previousIdToken ?? creds.access,
			accessToken: creds.access,
			refreshToken: creds.refresh,
			accountId: typeof creds.accountId === "string" ? creds.accountId : undefined,
			lastRefresh: new Date().toISOString(),
		});
		if (existing) {
			existing.auth = auth;
			if (touchLastUsed) existing.lastUsed = now;
		} else {
			this.data.accounts.push({
				email,
				auth,
				lastUsed: touchLastUsed ? now : undefined,
			});
		}
		if (setActive) this.data.activeEmail = email;
		this.save();
	}

	private toOAuthAuthEntry(account: StoredAccount): OAuthAuthEntry {
		return createOAuthAuthEntry(account);
	}

	private readRuntimeAuthEntry(
		ctx?: ExtensionContext,
	): { available: boolean; readable: boolean; entry?: OAuthAuthEntry } {
		const authStorage = getAuthStorage(ctx);
		if (!authStorage) return { available: false, readable: false };
		try {
			return {
				available: true,
				readable: true,
				entry: parseOAuthAuthEntry(authStorage.get(OPENAI_CODEX_PROVIDER)),
			};
		} catch {
			return { available: true, readable: false };
		}
	}

	syncAccountToAuth(account: StoredAccount, ctx?: ExtensionContext): void {
		const nextEntry = this.toOAuthAuthEntry(account);
		const authStorage = getAuthStorage(ctx);
		if (authStorage) {
			authStorage.set(OPENAI_CODEX_PROVIDER, nextEntry);
			authStorage.reload();
			return;
		}

		const auth = loadAuthData();
		auth[OPENAI_CODEX_PROVIDER] = nextEntry;
		writeJsonFile(AUTH_FILE, auth);
	}

	syncActiveToAuth(ctx?: ExtensionContext): StoredAccount | undefined {
		const account = this.getActiveAccount();
		if (!account) return undefined;
		this.syncAccountToAuth(account, ctx);
		return account;
	}

	syncAccountToCodexAuth(account: StoredAccount): void {
		writeJsonFile(CODEX_AUTH_FILE, account.auth);
	}

	async ensureAccountFresh(email: string, minValidityMs = SWITCH_MIN_TOKEN_VALIDITY_MS): Promise<StoredAccount | undefined> {
		const account = this.getAccount(email);
		if (!account) return undefined;
		const expiresAt = getStoredExpiresAt(account);
		if (typeof expiresAt === "number" && Date.now() < expiresAt - minValidityMs) {
			return account;
		}

		const refreshed = await refreshOpenAICodexAuth(getStoredRefreshToken(account));
		this.addOrUpdateAccount(account.email, refreshed, { setActive: false, touchLastUsed: false });
		return this.getAccount(account.email);
	}

	private async ensureValidToken(account: StoredAccount): Promise<StoredAccount> {
		const expiresAt = getStoredExpiresAt(account);
		if (typeof expiresAt === "number" && Date.now() < expiresAt - 5 * 60 * 1000) {
			return account;
		}

		const refreshed = await refreshOpenAICodexAuth(getStoredRefreshToken(account));
		this.addOrUpdateAccount(account.email, refreshed, { setActive: false, touchLastUsed: false });
		return this.getAccount(account.email) ?? {
			...account,
			auth: createCodexAuthPayload({
				idToken: refreshed.idToken ?? account.auth.tokens.id_token,
				accessToken: refreshed.access,
				refreshToken: refreshed.refresh,
				accountId: typeof refreshed.accountId === "string" ? refreshed.accountId : getStoredAccountId(account),
				lastRefresh: new Date().toISOString(),
			}),
		};
	}

	async getUsageForAccount(account: StoredAccount, options?: { force?: boolean }): Promise<CodexUsageSnapshot | undefined> {
		const cached = this.usageCache.get(account.email);
		if (cached && !options?.force && Date.now() - cached.fetchedAt < USAGE_CACHE_TTL_MS) {
			return cached;
		}

		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const resolvedAccount = await this.ensureValidToken(account);
			const controller = new AbortController();
			timeout = setTimeout(() => controller.abort(), USAGE_REQUEST_TIMEOUT_MS);
			const headers: Record<string, string> = {
				Authorization: `Bearer ${getStoredAccessToken(resolvedAccount)}`,
				Accept: "application/json",
			};
			const accountId = getStoredAccountId(resolvedAccount);
			if (accountId) {
				headers["ChatGPT-Account-Id"] = accountId;
			}

			const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
				headers,
				signal: controller.signal,
			});

			if (!response.ok) {
				return undefined;
			}

			const data = (await response.json()) as WhamUsageResponse;
			const snapshot: CodexUsageSnapshot = {
				...parseUsageResponse(data),
				fetchedAt: Date.now(),
			};
			this.usageCache.set(account.email, snapshot);
			return snapshot;
		} catch {
			return undefined;
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	isAuthSyncedFor(email: string, ctx?: ExtensionContext): boolean {
		const account = this.getAccount(email);
		if (!account) return false;
		const expected = this.toOAuthAuthEntry(account);
		const runtime = this.readRuntimeAuthEntry(ctx);

		if (runtime.available && runtime.readable) {
			return (
				runtime.entry?.refresh === expected.refresh &&
				runtime.entry.access === expected.access
			);
		}

		const fileEntry = extractOpenAICodexAuth(loadAuthData());
		if (!fileEntry) return false;
		return fileEntry.refresh === expected.refresh && fileEntry.access === expected.access;
	}

	isCodexAuthSyncedFor(email: string): boolean {
		const account = this.getAccount(email);
		if (!account) return false;
		return areCodexAuthPayloadsEqual(loadCodexAuthData(), account.auth);
	}

}

async function openLoginInBrowser(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	url: string,
): Promise<void> {
	const attempts: Array<{ command: string; args: string[] }> = [];

	if (process.platform === "darwin") {
		attempts.push({ command: "open", args: [url] });
	} else if (process.platform === "win32") {
		attempts.push({ command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] });
		attempts.push({ command: "explorer.exe", args: [url] });
	} else {
		attempts.push({ command: "xdg-open", args: [url] });
	}

	for (const attempt of attempts) {
		try {
			await pi.exec(attempt.command, attempt.args);
			return;
		} catch {
			// Try the next opener.
		}
	}

	ctx.ui.notify("Could not open browser automatically. Open login URL manually.", "warning");
}

export default function multicodexExtension(pi: ExtensionAPI) {
	const manager = new ManualAccountManager();
	const warningState = new RateLimitWarningState();
	let latestCtx: ExtensionContext | undefined;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let pollInFlight = false;
	let statusRequestId = 0;

	function rememberContext(ctx?: ExtensionContext): void {
		if (ctx?.hasUI) latestCtx = ctx;
	}

	async function resolveUsage(account: StoredAccount, options?: { force?: boolean }): Promise<CodexUsageSnapshot | undefined> {
		return manager.getUsageForAccount(account, options);
	}

	function notifyWarnings(ctx: ExtensionContext, account: StoredAccount, usage?: CodexUsageSnapshot): void {
		for (const warning of warningState.takeWarnings(account.email, usage)) {
			ctx.ui.notify(warning, "warning");
		}
	}

	async function updateStatus(
		ctx?: ExtensionContext,
		options?: { force?: boolean; notifyWarnings?: boolean },
	): Promise<CodexUsageSnapshot | undefined> {
		rememberContext(ctx);
		if (!ctx?.hasUI) return undefined;
		const requestId = ++statusRequestId;
		const active = manager.getActiveAccount();
		if (!active) {
			if (requestId === statusRequestId) ctx.ui.setStatus("multicodex", undefined);
			return undefined;
		}

		const usage = await resolveUsage(active, options);
		if (requestId !== statusRequestId) return usage;
		ctx.ui.setStatus("multicodex", formatStatusSummary(usage));
		if (options?.notifyWarnings) notifyWarnings(ctx, active, usage);
		return usage;
	}

	function stopPolling(): void {
		if (!pollTimer) return;
		clearInterval(pollTimer);
		pollTimer = undefined;
	}

	function startPolling(ctx?: ExtensionContext): void {
		rememberContext(ctx);
		stopPolling();
		if (!ctx?.hasUI) return;

		pollTimer = setInterval(() => {
			if (pollInFlight || !latestCtx?.hasUI) return;
			pollInFlight = true;
			void updateStatus(latestCtx, { force: true, notifyWarnings: true }).finally(() => {
				pollInFlight = false;
			});
		}, USAGE_POLL_INTERVAL_MS);
	}

	pi.registerCommand("multicodex-login", {
		description: "Login Codex account and save for manual switching",
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			rememberContext(ctx);
			const email = args.trim();
			if (!email) {
				ctx.ui.notify("Usage: /multicodex-login <email-or-label>", "error");
				return;
			}

			try {
				ctx.ui.notify("Starting login...", "info");
				const creds = await loginOpenAICodex({
					onAuth: ({ url }) => {
						void openLoginInBrowser(pi, ctx, url);
						ctx.ui.notify(`Login URL: ${url}`, "info");
					},
					onPrompt: async ({ message }) => (await ctx.ui.input(message)) || "",
				});
				const codexCreds = await refreshOpenAICodexAuth(creds.refresh).catch(() => ({
					...creds,
					idToken: creds.access,
				}));

				manager.addOrUpdateAccount(email, codexCreds);
				const active = manager.syncActiveToAuth(ctx);
				startPolling(ctx);
				await updateStatus(ctx, { force: true, notifyWarnings: true });
				ctx.ui.notify(`Saved account${active ? " and synced to openai-codex" : ""}`, "info");
			} catch (error) {
				ctx.ui.notify(`Login failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	async function switchActiveAccount(email: string, ctx: ExtensionCommandContext): Promise<boolean> {
		try {
			const freshAccount = await manager.ensureAccountFresh(email);
			if (!freshAccount) {
				ctx.ui.notify("Failed to sync Pi auth", "error");
				return false;
			}

			manager.syncAccountToAuth(freshAccount, ctx);
			if (!manager.isAuthSyncedFor(email, ctx)) {
				ctx.ui.notify("Pi sync incomplete: runtime auth did not match selected account", "error");
				return false;
			}

			manager.setActiveAccount(email);
			startPolling(ctx);
			void updateStatus(ctx, { force: true, notifyWarnings: true });
			ctx.ui.notify("Synced selected account to Pi auth", "info");
			return true;
		} catch (error) {
			ctx.ui.notify(`Pi sync failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	}

	async function switchCodexAccount(email: string, ctx: ExtensionCommandContext): Promise<boolean> {
		try {
			const freshAccount = await manager.ensureAccountFresh(email);
			if (!freshAccount) {
				ctx.ui.notify("Failed to sync Codex auth", "error");
				return false;
			}

			manager.syncAccountToCodexAuth(freshAccount);
			if (!manager.isCodexAuthSyncedFor(email)) {
				ctx.ui.notify("Codex sync incomplete: ~/.codex/auth.json did not match selected account", "error");
				return false;
			}

			manager.setCodexActiveAccount(email);
			ctx.ui.notify("Synced selected account to ~/.codex/auth.json", "info");
			return true;
		} catch (error) {
			ctx.ui.notify(`Codex sync failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	}

	function resolveUsageOverlayOptions(): { anchor: "center"; width: number; maxHeight: number; margin: number } {
		const terminalWidth =
			typeof process.stdout.columns === "number" && Number.isFinite(process.stdout.columns)
				? process.stdout.columns
				: 120;
		const terminalHeight =
			typeof process.stdout.rows === "number" && Number.isFinite(process.stdout.rows)
				? process.stdout.rows
				: 36;
		const margin = 1;
		const availableWidth = Math.max(62, terminalWidth - margin * 2);
		const preferredWidth = terminalWidth >= 140 ? 100 : terminalWidth >= 110 ? 92 : 82;
		const width = Math.max(62, Math.min(preferredWidth, availableWidth));
		const availableHeight = Math.max(14, terminalHeight - margin * 2);
		const maxHeight = Math.min(Math.max(14, Math.floor(terminalHeight * 0.8)), availableHeight);
		return { anchor: "center", width, maxHeight, margin };
	}

	async function openUsagePanel(ctx: ExtensionCommandContext): Promise<void> {
		rememberContext(ctx);
		const accounts = manager.getAccounts();
		if (accounts.length === 0) {
			ctx.ui.notify("No accounts saved. Use /multicodex-login first.", "warning");
			return;
		}
		if (!ctx.hasUI) {
			ctx.ui.notify("MultiCodex usage panel requires interactive UI.", "warning");
			return;
		}

		const overlayOptions = resolveUsageOverlayOptions();
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => {
				const overlay = new MultiCodexUsageOverlay(
					tui,
					theme,
					accounts,
					manager.getActiveAccount()?.email,
					manager.getCodexActiveAccount()?.email,
					(email) => manager.isAuthSyncedFor(email, ctx),
					(email) => manager.isCodexAuthSyncedFor(email),
					(account, force) => resolveUsage(account, { force }),
					(email) => switchActiveAccount(email, ctx),
					(email) => switchCodexAccount(email, ctx),
					() => done(undefined),
				);
				queueMicrotask(() => overlay.start());
				return overlay;
			},
			{ overlay: true, overlayOptions },
		);
	}

	const registerUsagePanelCommand = (name: string, description: string): void => {
		pi.registerCommand(name, {
			description,
			handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
				await openUsagePanel(ctx);
			},
		});
	};

	registerUsagePanelCommand("multicodex-usage", "Show usage and switch active Codex account");

	pi.on("session_start", async (_event, ctx) => {
		rememberContext(ctx);
		manager.syncActiveToAuth(ctx);
		startPolling(ctx);
		await updateStatus(ctx, { notifyWarnings: true });
	});

	pi.on("session_switch", async (_event, ctx) => {
		rememberContext(ctx);
		startPolling(ctx);
		await updateStatus(ctx, { notifyWarnings: true });
	});

	pi.on("agent_end", async (_event, ctx) => {
		rememberContext(ctx);
		await updateStatus(ctx, { force: true, notifyWarnings: true });
	});

	pi.on("session_shutdown", async () => {
		stopPolling();
		latestCtx = undefined;
	});
}
