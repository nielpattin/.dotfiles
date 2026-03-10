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

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { loginOpenAICodex, refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type TUI } from "@mariozechner/pi-tui";

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
	private switchingEmail?: string;
	private disposed = false;
	private refreshRequestId = 0;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		accounts: StoredAccount[],
		private readonly activeEmail: string | undefined,
		private readonly isAuthSynced: (email: string) => boolean,
		private readonly loadUsage: (account: StoredAccount, force?: boolean) => Promise<CodexUsageSnapshot | undefined>,
		private readonly switchAccount: (email: string) => Promise<boolean>,
		private readonly done: () => void,
	) {
		this.rows = accounts.map((account) => ({
			account,
			loading: true,
		}));
		const activeIndex = accounts.findIndex((account) => account.email === activeEmail);
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
			void this.activateSelected();
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
		lines.push(row(` ${th.fg("dim", "Enter switch • r refresh • Esc close")}`));
		lines.push(row());

		for (let i = 0; i < this.rows.length; i += 1) {
			const item = this.rows[i]!;
			const isSelected = i === this.selectedIndex;
			const isActive = this.activeEmail === item.account.email;
			const prefix = isSelected ? th.fg("accent", "▶") : th.fg("dim", "•");
			const labelTags = formatAccountTags([
				isActive ? "active" : null,
				this.isAuthSynced(item.account.email) ? "synced" : null,
				this.switchingEmail === item.account.email ? "switching" : null,
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

	private async activateSelected(): Promise<void> {
		const selected = this.rows[this.selectedIndex];
		if (!selected || this.switchingEmail) return;
		if (selected.account.email === this.activeEmail) {
			this.done();
			return;
		}
		this.switchingEmail = selected.account.email;
		this.refresh();
		const ok = await this.switchAccount(selected.account.email);
		if (this.disposed) return;
		this.switchingEmail = undefined;
		if (ok) {
			this.done();
			return;
		}
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

	setActiveAccount(email: string): void {
		const account = this.getAccount(email);
		if (!account) return;
		account.lastUsed = Date.now();
		this.data.activeEmail = account.email;
		this.save();
	}

	addOrUpdateAccount(
		email: string,
		creds: OAuthCredentials,
		options?: { setActive?: boolean; touchLastUsed?: boolean },
	): void {
		const setActive = options?.setActive ?? true;
		const touchLastUsed = options?.touchLastUsed ?? true;
		const now = Date.now();
		const accountId = typeof creds.accountId === "string" ? creds.accountId : undefined;
		const existing = this.getAccount(email);
		if (existing) {
			existing.accessToken = creds.access;
			existing.refreshToken = creds.refresh;
			existing.expiresAt = creds.expires;
			existing.accountId = accountId;
			if (touchLastUsed) existing.lastUsed = now;
		} else {
			this.data.accounts.push({
				email,
				accessToken: creds.access,
				refreshToken: creds.refresh,
				expiresAt: creds.expires,
				accountId,
				lastUsed: touchLastUsed ? now : undefined,
			});
		}
		if (setActive) this.data.activeEmail = email;
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

	async ensureAccountFresh(email: string, minValidityMs = SWITCH_MIN_TOKEN_VALIDITY_MS): Promise<StoredAccount | undefined> {
		const account = this.getAccount(email);
		if (!account) return undefined;
		if (Date.now() < account.expiresAt - minValidityMs) {
			return account;
		}

		const refreshed = await refreshOpenAICodexToken(account.refreshToken);
		this.addOrUpdateAccount(account.email, refreshed, { setActive: false, touchLastUsed: false });
		return this.getAccount(account.email);
	}

	private async ensureValidToken(account: StoredAccount): Promise<StoredAccount> {
		if (Date.now() < account.expiresAt - 5 * 60 * 1000) {
			return account;
		}

		const refreshed = await refreshOpenAICodexToken(account.refreshToken);
		this.addOrUpdateAccount(account.email, refreshed, { setActive: false, touchLastUsed: false });
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

				manager.addOrUpdateAccount(email, creds);
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
				ctx.ui.notify("Failed to switch account", "error");
				return false;
			}

			manager.syncAccountToAuth(freshAccount, ctx);
			if (!manager.isAuthSyncedFor(email, ctx)) {
				ctx.ui.notify("Switch incomplete: runtime auth did not match selected account", "error");
				return false;
			}

			manager.setActiveAccount(email);
			startPolling(ctx);
			void updateStatus(ctx, { force: true, notifyWarnings: true });
			ctx.ui.notify("Switched account (openai-codex synced)", "info");
			return true;
		} catch (error) {
			ctx.ui.notify(`Switch failed: ${error instanceof Error ? error.message : String(error)}`, "error");
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
					(email) => manager.isAuthSyncedFor(email, ctx),
					(account, force) => resolveUsage(account, { force }),
					(email) => switchActiveAccount(email, ctx),
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
