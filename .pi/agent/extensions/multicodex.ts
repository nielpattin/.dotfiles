/*
 * MultiCodex (manual account switch)
 *
 * Purpose:
 * - Keep using built-in provider: openai-codex
 * - Manage multiple Codex OAuth accounts
 * - Manually switch active account via /multicodex-use
 *
 * This extension DOES NOT register a custom provider and does NOT intercept streaming.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	loginOpenAICodex,
	refreshOpenAICodexToken,
	type OAuthCredentials,
} from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";

interface StoredAccount {
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
}

interface OAuthAuthEntry {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	[key: string]: unknown;
}

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const STORAGE_FILE = path.join(AGENT_DIR, "multicodex.json");
const AUTH_FILE = path.join(AGENT_DIR, "auth.json");
const OPENAI_CODEX_PROVIDER = "openai-codex";
const USAGE_REQUEST_TIMEOUT_MS = 10_000;
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const SWITCH_MIN_TOKEN_VALIDITY_MS = 2 * 60 * 1000;

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
	ensureAgentDir();
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function normalizeStorage(raw: unknown): StorageData {
	if (!raw || typeof raw !== "object") {
		return { accounts: [] };
	}

	const input = raw as Partial<StorageData>;
	const accounts = Array.isArray(input.accounts) ? input.accounts : [];
	const normalized: StoredAccount[] = [];

	for (const item of accounts) {
		if (!item || typeof item !== "object") continue;
		const acc = item as Partial<StoredAccount>;
		if (
			typeof acc.email !== "string" ||
			typeof acc.accessToken !== "string" ||
			typeof acc.refreshToken !== "string" ||
			typeof acc.expiresAt !== "number"
		) {
			continue;
		}
		normalized.push({
			email: acc.email,
			accessToken: acc.accessToken,
			refreshToken: acc.refreshToken,
			expiresAt: acc.expiresAt,
			accountId: typeof acc.accountId === "string" ? acc.accountId : undefined,
			lastUsed: typeof acc.lastUsed === "number" ? acc.lastUsed : undefined,
		});
	}

	return {
		accounts: normalized,
		activeEmail: typeof input.activeEmail === "string" ? input.activeEmail : undefined,
	};
}

function loadAuthData(): Record<string, unknown> {
	const parsed = readJsonFile<unknown>(AUTH_FILE);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {};
	}
	return parsed as Record<string, unknown>;
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

function formatResetAt(resetAt?: number): string {
	if (!resetAt) return "unknown";
	const diffMs = resetAt - Date.now();
	if (diffMs <= 0) return "now";
	const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
	if (diffMinutes < 60) return `in ${diffMinutes}m`;
	const diffHours = Math.round(diffMinutes / 60);
	if (diffHours < 48) return `in ${diffHours}h`;
	const diffDays = Math.round(diffHours / 24);
	return `in ${diffDays}d`;
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

	setActiveAccount(email: string): void {
		const account = this.getAccount(email);
		if (!account) return;
		account.lastUsed = Date.now();
		this.data.activeEmail = account.email;
		this.save();
	}

	addOrUpdateAccount(email: string, creds: OAuthCredentials): void {
		const accountId = typeof creds.accountId === "string" ? creds.accountId : undefined;
		const existing = this.getAccount(email);
		if (existing) {
			existing.accessToken = creds.access;
			existing.refreshToken = creds.refresh;
			existing.expiresAt = creds.expires;
			existing.accountId = accountId;
			existing.lastUsed = Date.now();
		} else {
			this.data.accounts.push({
				email,
				accessToken: creds.access,
				refreshToken: creds.refresh,
				expiresAt: creds.expires,
				accountId,
				lastUsed: Date.now(),
			});
		}
		this.data.activeEmail = email;
		this.save();
	}

	private toOAuthAuthEntry(account: StoredAccount): OAuthAuthEntry {
		return {
			type: "oauth",
			access: account.accessToken,
			refresh: account.refreshToken,
			expires: account.expiresAt,
			...(account.accountId ? { accountId: account.accountId } : {}),
		};
	}

	private readRuntimeAuthEntry(ctx?: ExtensionContext): OAuthAuthEntry | undefined {
		const authStorage = getAuthStorage(ctx);
		if (!authStorage) return undefined;
		return parseOAuthAuthEntry(authStorage.get(OPENAI_CODEX_PROVIDER));
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

	async ensureAccountFresh(email: string, minValidityMs = SWITCH_MIN_TOKEN_VALIDITY_MS): Promise<StoredAccount | undefined> {
		const account = this.getAccount(email);
		if (!account) return undefined;
		if (Date.now() < account.expiresAt - minValidityMs) {
			return account;
		}

		const refreshed = await refreshOpenAICodexToken(account.refreshToken);
		this.addOrUpdateAccount(account.email, refreshed);
		return this.getAccount(account.email);
	}

	private async ensureValidToken(account: StoredAccount): Promise<StoredAccount> {
		if (Date.now() < account.expiresAt - 5 * 60 * 1000) {
			return account;
		}

		const refreshed = await refreshOpenAICodexToken(account.refreshToken);
		this.addOrUpdateAccount(account.email, refreshed);
		return this.getAccount(account.email) ?? {
			...account,
			accessToken: refreshed.access,
			refreshToken: refreshed.refresh,
			expiresAt: refreshed.expires,
			accountId: typeof refreshed.accountId === "string" ? refreshed.accountId : account.accountId,
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
				Authorization: `Bearer ${resolvedAccount.accessToken}`,
				Accept: "application/json",
			};
			if (resolvedAccount.accountId) {
				headers["ChatGPT-Account-Id"] = resolvedAccount.accountId;
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
		if (runtime && runtime.refresh === expected.refresh && runtime.access === expected.access) {
			return true;
		}
		const fileEntry = extractOpenAICodexAuth(loadAuthData());
		if (!fileEntry) return false;
		return fileEntry.refresh === expected.refresh && fileEntry.access === expected.access;
	}

}

async function openLoginInBrowser(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	url: string,
): Promise<void> {
	let command: string;
	let args: string[];

	if (process.platform === "darwin") {
		command = "open";
		args = [url];
	} else if (process.platform === "win32") {
		command = "cmd";
		args = ["/c", "start", "", url];
	} else {
		command = "xdg-open";
		args = [url];
	}

	try {
		await pi.exec(command, args);
	} catch {
		ctx.ui.notify("Could not open browser automatically. Open login URL manually.", "warning");
	}
}

export default function multicodexExtension(pi: ExtensionAPI) {
	const manager = new ManualAccountManager();
	let lastContext: ExtensionContext | undefined;

	pi.registerCommand("multicodex-login", {
		description: "Login Codex account and save for manual switching",
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
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

				manager.addOrUpdateAccount(email, creds);
				const active = manager.syncActiveToAuth(ctx);
				ctx.ui.setStatus("multicodex", undefined);
				ctx.ui.notify(`Saved account${active ? " and synced to openai-codex" : ""}`, "info");
			} catch (error) {
				ctx.ui.notify(`Login failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("multicodex-use", {
		description: "Manually switch active Codex account",
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const accounts = manager.getAccounts();
			if (accounts.length === 0) {
				ctx.ui.notify("No accounts saved. Use /multicodex-login first.", "warning");
				return;
			}

			const active = manager.getActiveAccount();
			const accountOptions = accounts.map((account) => ({
				email: account.email,
				label: `${account.email}${active?.email === account.email ? " (active)" : ""}`,
			}));
			const selected = await ctx.ui.select(
				"Select account",
				accountOptions.map((option) => option.label),
			);
			if (!selected) return;

			const selectedAccount = accountOptions.find((option) => option.label === selected);
			const email = selectedAccount?.email ?? "";
			if (!email) {
				ctx.ui.notify("Invalid account selection", "error");
				return;
			}

			manager.setActiveAccount(email);
			const freshAccount = await manager.ensureAccountFresh(email);
			if (!freshAccount) {
				ctx.ui.notify("Failed to switch account", "error");
				return;
			}

			manager.syncAccountToAuth(freshAccount, ctx);
			if (!manager.isAuthSyncedFor(email, ctx)) {
				ctx.ui.notify("Switch incomplete: runtime auth did not match selected account", "error");
				return;
			}

			ctx.ui.setStatus("multicodex", undefined);
			ctx.ui.notify("Switched account (openai-codex synced)", "info");
		},
	});

	pi.registerCommand("multicodex-status", {
		description: "Show saved accounts with 5h/weekly usage windows",
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const accounts = manager.getAccounts();
			if (accounts.length === 0) {
				ctx.ui.notify("No accounts saved. Use /multicodex-login first.", "warning");
				return;
			}

			const active = manager.getActiveAccount();
			const usagePairs = await Promise.all(
				accounts.map(async (account) => ({
					account,
					usage: await manager.getUsageForAccount(account),
				})),
			);

			const options = usagePairs.map(({ account, usage }) => {
				const isActive = active?.email === account.email;
				const tags = [isActive ? "active" : null, manager.isAuthSyncedFor(account.email, ctx) ? "auth-synced" : null]
					.filter(Boolean)
					.join(", ");
				const suffix = tags ? ` (${tags})` : "";

				const primaryUsed = usage?.primary?.usedPercent;
				const secondaryUsed = usage?.secondary?.usedPercent;
				const primaryReset = usage?.primary?.resetAt;
				const secondaryReset = usage?.secondary?.resetAt;

				const primaryLabel = primaryUsed === undefined ? "unknown" : `${Math.round(primaryUsed)}%`;
				const secondaryLabel = secondaryUsed === undefined ? "unknown" : `${Math.round(secondaryUsed)}%`;
				const usageSummary = `5h ${primaryLabel} reset:${formatResetAt(primaryReset)} | weekly ${secondaryLabel} reset:${formatResetAt(secondaryReset)}`;

				return `${isActive ? "•" : " "} ${account.email}${suffix} - ${usageSummary}`;
			});

			await ctx.ui.select("MultiCodex Accounts", options);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		lastContext = ctx;
		manager.syncActiveToAuth(ctx);
		ctx.ui.setStatus("multicodex", undefined);
	});

	pi.on("session_switch", async (_event, ctx) => {
		lastContext = ctx;
		ctx.ui.setStatus("multicodex", undefined);
	});

	// Keep lastContext used for future diagnostics without auto-notify spam.
	void lastContext;
}
