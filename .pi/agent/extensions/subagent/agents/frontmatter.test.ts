import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentFile } from "./frontmatter.js";
import { updateAgentDefaultsInFile } from "./update.js";

const tempDirs: string[] = [];

function makeAgentFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-frontmatter-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "worker.md");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent frontmatter", () => {
  it("parses only canonical skills/extensions/cwd fields", () => {
    const filePath = makeAgentFile(`---
name: worker
description: handles tasks
skill: legacy-skill
enabledExtensions:
  - legacy-ext
defaultCwd: /legacy
---
You are a worker.
`);

    const parsed = parseAgentFile(filePath, "user");
    expect(parsed).not.toBeNull();
    expect(parsed?.skills).toBeUndefined();
    expect(parsed?.extensions).toBeUndefined();
    expect(parsed?.cwd).toBeUndefined();
  });

  it("updates canonical defaults and strips legacy alias keys", () => {
    const filePath = makeAgentFile(`---
name: worker
description: handles tasks
skill: legacy-skill
enabledExtensions:
  - legacy-ext
defaultCwd: /legacy
---
You are a worker.
`);

    updateAgentDefaultsInFile(filePath, {
      skills: ["triage-expert"],
      extensions: ["read-map"],
      cwd: "/repo",
    });

    const next = fs.readFileSync(filePath, "utf-8");
    expect(next).toContain('skills: - "triage-expert"');
    expect(next).toContain('extensions: - "read-map"');
    expect(next).toContain('cwd: "/repo"');
    expect(next).not.toContain("skill:");
    expect(next).not.toContain("enabledExtensions:");
    expect(next).not.toContain("defaultCwd:");
  });
});
