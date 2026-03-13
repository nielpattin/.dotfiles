import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface AvailableExtensionInfo {
  name: string;
  source: "user" | "project";
}

function findNearestProjectExtensionsDir(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, ".pi", "extensions");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Ignore missing directory.
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function listExtensionsFromDir(
  dir: string,
  source: "user" | "project",
): AvailableExtensionInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const extensions: AvailableExtensionInfo[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const isEntry = [".ts", ".js", ".mjs", ".cjs"].includes(ext);
      if (!isEntry || entry.name.includes(".test.")) continue;
      const name = path.basename(entry.name, ext).trim();
      if (!name || name === "index") continue;
      extensions.push({ name, source });
      continue;
    }

    if (entry.isDirectory()) {
      const candidateFiles = ["index.ts", "index.js", "index.mjs", "index.cjs"];
      const hasIndex = candidateFiles.some((fileName) => fs.existsSync(path.join(dir, entry.name, fileName)));
      if (!hasIndex) continue;
      extensions.push({ name: entry.name, source });
    }
  }

  return extensions;
}

export function discoverExtensionsForTaskConfig(cwd: string): AvailableExtensionInfo[] {
  const userDir = path.join(os.homedir(), ".pi", "agent", "extensions");
  const projectDir = findNearestProjectExtensionsDir(cwd);

  const map = new Map<string, AvailableExtensionInfo>();
  for (const extension of listExtensionsFromDir(userDir, "user")) {
    map.set(extension.name, extension);
  }
  if (projectDir) {
    for (const extension of listExtensionsFromDir(projectDir, "project")) {
      map.set(extension.name, extension);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}
