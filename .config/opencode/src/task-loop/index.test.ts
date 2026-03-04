import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { findPrdJson, isPrdComplete, processOutput, VERSION } from "./index";
import { mkdir, writeFile, rm } from "node:fs/promises";

describe("task-loop unit tests", () => {
  test("version is correct", () => {
    expect(VERSION).toBe("1.2.0");
  });

  test("processOutput strips bold and fixes colors", () => {
    const input = new TextEncoder().encode("**bold** \x1b[30mblack label\x1b[0m");
    const output = processOutput(input);
    expect(output).toBe("bold \x1b[32mblack label\x1b[0m");
    expect(output).not.toContain("**");
    expect(output).toContain("\x1b[32m");
  });
});

describe("file-based logic", () => {
  const testDir = `${process.cwd()}/test-tmp`;
  const feature = "test-feat";
  const prdDir = `${testDir}/.opencode/state/${feature}`;
  const prdPath = `${prdDir}/prd.json`;

  beforeAll(async () => {
    await mkdir(prdDir, { recursive: true });
    await writeFile(prdPath, "{}"); // Ensure file exists for findPrdJson
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("findPrdJson finds nested state folder", () => {
    const found = findPrdJson(feature, testDir);
    expect(found).not.toBeNull();
    if (found) {
      expect(found).toContain(feature);
      expect(found).toContain("prd.json");
    }
  });

  test("isPrdComplete handles false states", async () => {
    await writeFile(prdPath, JSON.stringify({
      tasks: [{ id: "1", passes: false }]
    }));
    expect(await isPrdComplete(prdPath)).toBe(false);
  });

  test("isPrdComplete handles true states", async () => {
    await writeFile(prdPath, JSON.stringify({
      tasks: [{ id: "1", passes: true }, { id: "2", passes: true }]
    }));
    expect(await isPrdComplete(prdPath)).toBe(true);
  });

  test("isPrdComplete handles missing passes field", async () => {
    await writeFile(prdPath, JSON.stringify({
      tasks: [{ id: "1" }]
    }));
    expect(await isPrdComplete(prdPath)).toBe(false);
  });
});
