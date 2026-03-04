/**
 * Amp Permissions Extension
 *
 * Reads exec permissions from Amp-format settings and intercepts bash tool calls.
 *
 * Settings are loaded from (in order, merged):
 *   ~/.config/amp/settings.json  (global)
 *   .agents/settings.json        (project-local)
 *
 * Relevant settings keys:
 *
 *   "amp.commands.allowlist": ["git", "npm", "./test.sh"]
 *     Base command names that are auto-allowed (checked before permissions rules).
 *     Also matched after stripping a leading "cd <dir> &&" prefix.
 *
 *   "amp.permissions": [
 *     { "tool": "Bash", "matches": { "cmd": "/\\brm\\b/" }, "action": "ask" },
 *     { "tool": "Bash", "matches": { "cmd": "*" },          "action": "allow" }
 *   ]
 *     Ordered rules. First matching Bash rule wins. cmd can be:
 *       /regex/flags  — JS regex literal syntax
 *       *             — matches any command
 *       <glob>        — * wildcards supported; matched against the full command
 *     Actions: "allow" | "ask" | "deny" | "reject"
 *     Non-Bash rules are loaded and warned about, but otherwise ignored.
 *
 * Extension settings (~/.pi/agent/amplike.json):
 *   { "permissions": { "mode": "enabled" | "yolo" } }
 *   Persisted by the /permissions command across pi invocations.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface AmpPermission {
	tool: string;
	matches?: { cmd?: string | string[] };
	action: "allow" | "ask" | "deny" | "reject";
}

interface AmpSettings {
	"amp.commands.allowlist"?: string[];
	"amp.permissions"?: AmpPermission[];
}

// Built-in amp permission rules (from amp source, as of early 2026)
const BUILTIN_PERMISSIONS: AmpPermission[] = [
	{ tool: "Bash", action: "ask", matches: { cmd: "*git*push*" } },
	{
		tool: "Bash",
		matches: {
			cmd: [
				"ls", "ls *", "dir", "dir *", "cat *", "head *", "tail *", "less *", "more *",
				"grep *", "egrep *", "fgrep *", "tree", "tree *", "file *", "wc *", "pwd",
				"stat *", "du *", "df *", "ps *", "top", "htop", "echo *", "printenv *", "id",
				"which *", "whereis *", "date", "cal *", "uptime", "free *", "ping *", "dig *",
				"nslookup *", "host *", "netstat *", "ss *", "lsof *", "ifconfig *", "ip *",
				"man *", "info *", "mkdir *", "touch *", "uname *", "whoami",
				"go version", "go env *", "go help *",
				"cargo version", "cargo --version", "cargo help *",
				"rustc --version", "rustc --help", "rustc --explain *",
				"javac --version", "javac -version", "javac -help", "javac --help",
				"dotnet --info", "dotnet --version", "dotnet --help", "dotnet help *",
				"gcc --version", "gcc -v", "gcc --help", "gcc -dumpversion",
				"g++ --version", "g++ -v", "g++ --help", "g++ -dumpversion",
				"clang --version", "clang --help", "clang++ --version", "clang++ --help",
				"python -V", "python --version", "python -h", "python --help",
				"python3 -V", "python3 --version", "python3 -h", "python3 --help",
				"ruby -v", "ruby --version", "ruby -h", "ruby --help",
				"node -v", "node --version", "node -h", "node --help",
				"npm --help", "npm --version", "npm -v", "npm help *",
				"yarn --help", "yarn --version", "yarn -v", "yarn help *",
				"pnpm --help", "pnpm --version", "pnpm -v", "pnpm help *",
				"pytest -h", "pytest --help", "pytest --version",
				"jest --help", "jest --version", "mocha --help", "mocha --version",
				"make --version", "make --help",
				"docker --version", "docker --help", "docker version", "docker help *",
				"git --version", "git --help", "git help *", "git version",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"go test *", "go run *", "go build *", "go vet *", "go fmt *", "go list *",
				"cargo test *", "cargo run *", "cargo build *", "cargo check *", "cargo fmt *", "cargo tree *",
				"make -n *", "make --dry-run *",
				"mvn test *", "mvn verify *", "mvn dependency:tree *",
				"gradle tasks *", "gradle dependencies *", "gradle properties *",
				"dotnet test *", "dotnet list *",
				"python -c *", "ruby -e *", "node -e *",
				"npm list *", "npm ls *", "npm outdated *", "npm test*", "npm run*", "npm view *", "npm info *",
				"yarn list*", "yarn ls *", "yarn info *", "yarn test*", "yarn run *", "yarn why *",
				"pnpm list*", "pnpm ls *", "pnpm outdated *", "pnpm test*", "pnpm run *",
				"pytest --collect-only *", "jest --listTests *", "jest --showConfig *", "mocha --list *",
				"git status*", "git show *", "git diff*", "git grep *", "git branch *", "git tag *",
				"git remote -v *", "git rev-parse --is-inside-work-tree *", "git rev-parse --show-toplevel *",
				"git config --list *", "git log *",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"./gradlew *", "./mvnw *", "./build.sh *", "./configure *", "cmake *",
				"./node_modules/.bin/tsc *", "./node_modules/.bin/eslint *",
				"./node_modules/.bin/prettier *", "prettier *",
				"./node_modules/.bin/tailwindcss *", "./node_modules/.bin/tsx *",
				"./node_modules/.bin/vite *", "bun *", "tsx *", "vite *",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				".venv/bin/activate *", ".venv/Scripts/activate *",
				"source .venv/bin/activate *", "source venv/bin/activate *",
				"pip list *", "pip show *", "pip check *", "pip freeze *",
				"uv *", "poetry show *", "poetry check *", "pipenv check *",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"asdf list *", "asdf current *", "asdf which *",
				"mise list *", "mise current *", "mise which *", "mise use *",
				"rbenv version *", "rbenv versions *", "rbenv which *",
				"nvm list *", "nvm current *", "nvm which *",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"./test*", "./run_tests.sh *", "./run_*_tests.sh *", "vitest *",
				"bundle exec rspec *", "bundle exec rubocop *", "rspec *", "rubocop *",
				"swiftlint *", "clippy *", "ruff *", "black *", "isort *",
				"mypy *", "flake8 *", "bandit *", "safety *", "biome check *", "biome format *",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"rails server *", "rails s *", "bin/rails server *", "bin/rails s *",
				"flask run *", "django-admin runserver *", "python manage.py runserver *",
				"uvicorn *", "streamlit run *",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"bin/rails db:status", "bin/rails db:version",
				"rails db:rollback *", "rails db:status *", "rails db:version *",
				"alembic current *", "alembic history *",
				"bundle exec rails db:status", "bundle exec rails db:version",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"docker ps *", "docker images *", "docker logs *", "docker inspect *",
				"docker info *", "docker stats *", "docker system df *", "docker system info *",
				"podman ps *", "podman images *", "podman logs *", "podman inspect *", "podman info *",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"aws --version *", "aws configure list *", "aws sts get-caller-identity *", "aws s3 ls *",
				"gcloud config list *", "gcloud auth list *", "gcloud projects list *",
				"az account list *", "az account show *",
				"kubectl get *", "kubectl describe *", "kubectl logs *", "kubectl version *",
				"helm list *", "helm status *", "helm version *",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"swift build *", "swift test *", "zig build *", "zig build test*",
				"kotlinc *", "scalac *", "javac *", "javap *", "clang *", "jar *",
				"sbt *", "gradle *", "bazel build *", "bazel test *", "bazel run *",
				"mix *", "lua *", "ruby *", "php *",
			],
		},
		action: "allow",
	},
	{
		tool: "Bash",
		matches: { cmd: ["mkdir -p *", "chmod +x *", "dos2unix *", "unix2dos *", "ln -s *"] },
		action: "allow",
	},
	{
		tool: "Bash",
		matches: {
			cmd: [
				"for *", "while *", "do *", "done *", "if *", "then *", "else *",
				"elif *", "fi *", "case *", "esac *", "in *", "function *",
				"select *", "until *", "{ *", "} *", "[[ *", "]] *",
			],
		},
		action: "ask",
	},
	{ tool: "Bash", matches: { cmd: "/^find(?!.*(-delete|-exec|-execdir)).*$/" }, action: "allow" },
	{
		tool: "Bash",
		matches: { cmd: "/^(echo|ls|pwd|date|whoami|id|uname)\\s.*[&|;].*\\s*(echo|ls|pwd|date|whoami|id|uname)($|\\s.*)/" },
		action: "allow",
	},
	{
		tool: "Bash",
		matches: { cmd: "/^(cat|grep|head|tail|less|more|find)\\s.*\\|\\s*(grep|head|tail|less|more|wc|sort|uniq)($|\\s.*)/" },
		action: "allow",
	},
	{
		tool: "Bash",
		matches: { cmd: "/^rm\\s+.*(-[rf].*-[rf]|-[rf]{2,}|--recursive.*--force|--force.*--recursive).*$/" },
		action: "ask",
	},
	{ tool: "Bash", matches: { cmd: "/^find.*(-delete|-exec|-execdir).*$/" }, action: "ask" },
	{ tool: "Bash", matches: { cmd: "/^(ls|cat|grep|head|tail|file|stat)\\s+[^/]*$/" }, action: "allow" },
	{
		tool: "Bash",
		matches: { cmd: "/^(?!.*(rm|mv|cp|chmod|chown|sudo|su|dd)\\b).*/dev/(null|zero|stdout|stderr|stdin).*$/" },
		action: "allow",
	},
	// Default: ask for any unmatched Bash command
	{ tool: "Bash", action: "ask" },
];

// Prefix that agents commonly prepend: "cd /some/dir && <actual command>"
const CD_PREFIX_RE = /^cd[^;&]*?&&\s*/;

function loadSettings(paths: string[]): AmpSettings {
	const merged: AmpSettings = {};
	for (const path of paths) {
		try {
			const data = JSON.parse(readFileSync(path, "utf8")) as AmpSettings;
			if (data["amp.commands.allowlist"]) {
				merged["amp.commands.allowlist"] = [
					...(merged["amp.commands.allowlist"] ?? []),
					...data["amp.commands.allowlist"],
				];
			}
			if (data["amp.permissions"]) {
				merged["amp.permissions"] = [
					...(merged["amp.permissions"] ?? []),
					...data["amp.permissions"],
				];
			}
		} catch {
			// File not found or invalid JSON — skip
		}
	}
	return merged;
}

function getBaseCommand(command: string): string {
	return command.trim().replace(CD_PREFIX_RE, "").trim().split(/\s+/)[0] ?? "";
}

function globToRegex(glob: string): RegExp {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

function matchesCmd(pattern: string | string[], command: string): boolean {
	if (Array.isArray(pattern)) {
		return pattern.some((p) => matchesCmd(p, command));
	}
	if (pattern === "*") return true;

	// Regex literal: /pattern/ or /pattern/flags
	const regexMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
	if (regexMatch) {
		const source = regexMatch[1];
		if (!source) return false;

		const flags = regexMatch[2] ?? "";
		try {
			return new RegExp(source, flags).test(command);
		} catch {
			return false;
		}
	}

	// Glob: match against full command
	return globToRegex(pattern).test(command);
}

function ruleAppliesToBash(rule: AmpPermission): boolean {
	// Simple glob check: does this tool pattern match "Bash"?
	if (rule.tool === "Bash") return true;
	if (rule.tool === "*") return true;
	try {
		return globToRegex(rule.tool).test("Bash");
	} catch {
		return false;
	}
}

const GLOBAL_SETTINGS = join(homedir(), ".config", "amp", "settings.json");

// Extension settings file — follows the ~/.pi/agent/<name>.json convention
const AMPLIKE_SETTINGS_PATH = join(homedir(), ".pi", "agent", "amplike.json");

interface AmplikeSettings {
	permissions?: {
		mode?: "enabled" | "yolo";
	};
}

function loadAmplikeSettings(): AmplikeSettings {
	try {
		return JSON.parse(readFileSync(AMPLIKE_SETTINGS_PATH, "utf8")) as AmplikeSettings;
	} catch {
		return {};
	}
}

function saveAmplikeSettings(settings: AmplikeSettings): void {
	const dir = dirname(AMPLIKE_SETTINGS_PATH);
	mkdirSync(dir, { recursive: true });
	const tmp = `${AMPLIKE_SETTINGS_PATH}.tmp.${process.pid}`;
	writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf8");
	renameSync(tmp, AMPLIKE_SETTINGS_PATH);
}

// Permission mode: "enabled" (default) or "yolo" (all commands allowed without checks)
// Loaded from amplike.json on startup; persisted on /permissions toggle.
let permissionMode: "enabled" | "yolo" = loadAmplikeSettings().permissions?.mode ?? "enabled";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("permissions", {
		description: "Toggle permission mode between 'enabled' (amp rules) and 'yolo' (all commands allowed)",
		handler: async (_args, ctx) => {
			if (permissionMode === "enabled") {
				permissionMode = "yolo";
				ctx.ui.setStatus("permissions", "YOLO mode");
				ctx.ui.notify("Permissions: switched to YOLO mode — all bash commands allowed without checks", "warning");
			} else {
				permissionMode = "enabled";
				ctx.ui.setStatus("permissions", undefined);
				ctx.ui.notify("Permissions: switched to enabled mode — amp permission rules active", "info");
			}
			const current = loadAmplikeSettings();
			saveAmplikeSettings({ ...current, permissions: { ...current.permissions, mode: permissionMode } });
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		// Restore status bar if yolo mode was persisted from a previous session
		if (permissionMode === "yolo") {
			ctx.ui.setStatus("permissions", "YOLO mode");
		}

		// Warn about any non-Bash permission rules in the user's config
		const settings = loadSettings([GLOBAL_SETTINGS, resolve(ctx.cwd, ".agents", "settings.json")]);
		const nonBashRules = (settings["amp.permissions"] ?? []).filter((r) => !ruleAppliesToBash(r));
		if (nonBashRules.length > 0) {
			const tools = [...new Set(nonBashRules.map((r) => r.tool))].join(", ");
			ctx.ui.notify(
				`permissions: ignoring ${nonBashRules.length} non-Bash amp.permissions rule(s) (tools: ${tools})`,
				"warning",
			);
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		// YOLO mode: bypass all permission checks
		if (permissionMode === "yolo") return undefined;

		const command = event.input.command as string;
		const strippedCommand = command.trim().replace(CD_PREFIX_RE, "").trim();

		const projectSettings = resolve(ctx.cwd, ".agents", "settings.json");
		const settings = loadSettings([GLOBAL_SETTINGS, projectSettings]);

		const allowlist = settings["amp.commands.allowlist"] ?? [];
		const userRules = settings["amp.permissions"] ?? [];
		const baseCmd = getBaseCommand(command);

		const NO_MATCH = Symbol();
		type RuleOutcome = typeof NO_MATCH | undefined | { block: true; reason: string };

		async function applyRules(rules: AmpPermission[]): Promise<RuleOutcome> {
			for (const rule of rules) {
				if (!ruleAppliesToBash(rule)) continue;
				const cmdPattern = rule.matches?.cmd;
				if (cmdPattern !== undefined && !matchesCmd(cmdPattern, strippedCommand)) continue;
				// Rule matched — resolve action
				if (rule.action === "allow") return undefined;
				if (rule.action === "deny" || rule.action === "reject") return { block: true, reason: "Denied by amp permissions" };
				if (rule.action === "ask") {
					if (!ctx.hasUI) return { block: true, reason: "Command requires confirmation (no UI available)" };
					const choice = await ctx.ui.select(
						`⚠️  Permission required:\n\n  ${command}\n\nAllow? (Use /permissions to toggle YOLO mode and skip these checks)`,
						["Yes", "No"],
					);
					if (choice !== "Yes") {
						ctx.abort();
						return { block: true, reason: "Blocked by user" };
					}
					return undefined;
				}
			}
			return NO_MATCH;
		}

		// User rules first (take precedence over allowlist + built-ins)
		const userResult = await applyRules(userRules);
		if (userResult !== NO_MATCH) return userResult;

		// Allowlist: after user rules, before built-ins
		if (allowlist.includes(baseCmd)) return undefined;

		// Built-in rules as final fallback
		const builtinResult = await applyRules(BUILTIN_PERMISSIONS);
		return builtinResult === NO_MATCH ? undefined : builtinResult;
	});
}
