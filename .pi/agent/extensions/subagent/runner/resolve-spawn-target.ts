import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);

export interface SpawnTarget {
  command: string;
  args: string[];
}

function isRunnableNodeScript(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  return /\.(?:mjs|cjs|js)$/i.test(filePath);
}

function findPackageJsonFromEntry(entryPath: string): string | null {
  let dir = path.dirname(path.resolve(entryPath));

  while (true) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
          name?: string;
        };
        if (pkg.name === "@mariozechner/pi-coding-agent") {
          return pkgPath;
        }
      } catch {
        // ignore parse/read issues and keep walking up
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveWindowsPiCliScript(): string | null {
  const argvEntry = process.argv[1];
  if (argvEntry) {
    const candidate = path.resolve(argvEntry);
    if (isRunnableNodeScript(candidate)) return candidate;

    const fromArgvPackage = findPackageJsonFromEntry(candidate);
    if (fromArgvPackage) {
      try {
        const pkg = JSON.parse(fs.readFileSync(fromArgvPackage, "utf-8")) as {
          bin?: string | Record<string, string>;
        };
        const binField = pkg.bin;
        const binPath =
          typeof binField === "string"
            ? binField
            : binField?.pi ?? Object.values(binField ?? {})[0];
        if (binPath) {
          const binCandidate = path.resolve(path.dirname(fromArgvPackage), binPath);
          if (isRunnableNodeScript(binCandidate)) return binCandidate;
        }
      } catch {
        // ignore and continue to package-based resolution
      }
    }
  }

  try {
    const entry = require.resolve("@mariozechner/pi-coding-agent");
    const packageJsonPath = findPackageJsonFromEntry(entry);
    if (!packageJsonPath) return null;

    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8"),
    ) as {
      bin?: string | Record<string, string>;
    };

    const binField = packageJson.bin;
    const binPath =
      typeof binField === "string"
        ? binField
        : binField?.pi ?? Object.values(binField ?? {})[0];

    if (!binPath) return null;

    const candidate = path.resolve(path.dirname(packageJsonPath), binPath);
    if (isRunnableNodeScript(candidate)) return candidate;
  } catch {
    return null;
  }

  return null;
}

export function resolveSpawnTarget(piArgs: string[]): SpawnTarget | null {
  if (process.platform === "win32") {
    const scriptPath = resolveWindowsPiCliScript();
    if (!scriptPath) return null;

    return {
      command: process.execPath,
      args: [scriptPath, ...piArgs],
    };
  }

  return { command: "pi", args: piArgs };
}
