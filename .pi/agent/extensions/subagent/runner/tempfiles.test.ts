import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeForkChildSessionFile, initializeSpawnChildSessionFile } from "./tempfiles.js";

const tempRoots: string[] = [];

function makePath(fileName: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-tempfiles-"));
  tempRoots.push(root);
  return path.join(root, fileName);
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("child session file initialization", () => {
  it("spawn init leaves child session file absent so Pi writes exactly one header", () => {
    const sessionFile = makePath("child.session.jsonl");
    initializeSpawnChildSessionFile(sessionFile);
    expect(fs.existsSync(sessionFile)).toBe(false);
  });

  it("fork init removes stale file/header before child starts", () => {
    const sessionFile = makePath("child-fork.session.jsonl");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, '{"type":"session","id":"old"}\n', "utf-8");

    initializeForkChildSessionFile(sessionFile);
    expect(fs.existsSync(sessionFile)).toBe(false);
  });
});
