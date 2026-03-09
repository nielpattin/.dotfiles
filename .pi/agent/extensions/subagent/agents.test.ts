import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const actualOs = await import("node:os");
const testRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-agents-test-"));
const testHomeDir = path.join(testRootDir, "home");
const userAgentsDir = path.join(testHomeDir, ".pi", "agent", "agents");
const projectRootDir = path.join(testRootDir, "repo");
const projectAgentsDir = path.join(projectRootDir, ".pi", "agents");
const nestedProjectCwd = path.join(projectRootDir, "packages", "app");

mock.module("node:os", () => ({
  ...actualOs,
  homedir: () => testHomeDir,
}));

// @ts-expect-error isolated import for test-local node:os mock
const { discoverAgents } = await import("./agents.ts?agents-test");

let warnSpy: ReturnType<typeof spyOn>;

function writeAgent(dir: string, fileName: string, content: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

beforeAll(() => {
  fs.mkdirSync(userAgentsDir, { recursive: true });
  fs.mkdirSync(projectAgentsDir, { recursive: true });
  fs.mkdirSync(nestedProjectCwd, { recursive: true });
});

afterAll(() => {
  warnSpy?.mockRestore();
  fs.rmSync(testRootDir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(userAgentsDir, { recursive: true, force: true });
  fs.rmSync(projectAgentsDir, { recursive: true, force: true });
  fs.mkdirSync(userAgentsDir, { recursive: true });
  fs.mkdirSync(projectAgentsDir, { recursive: true });
  warnSpy?.mockRestore();
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
});

describe("discoverAgents frontmatter parsing", () => {
  it("parses skills/extensions from comma-separated strings and yaml arrays", () => {
    writeAgent(
      userAgentsDir,
      "designer.md",
      [
        "---",
        "name: designer",
        "description: UI agent",
        "skills: ui-design",
        "extensions: rtk, read-map",
        "---",
        "Design things.",
      ].join("\n"),
    );

    writeAgent(
      userAgentsDir,
      "reviewer.md",
      [
        "---",
        "name: reviewer",
        "description: Review agent",
        "skills:",
        "  - resolve-conflicts",
        "extensions:",
        "  - rtk",
        "  - read-map",
        "---",
        "Review carefully.",
      ].join("\n"),
    );

    const { agents } = discoverAgents(nestedProjectCwd, "user");
    const designer = agents.find((agent: { name: string }) => agent.name === "designer");
    const reviewer = agents.find((agent: { name: string }) => agent.name === "reviewer");

    expect(designer?.skills).toEqual(["ui-design"]);
    expect(designer?.extensions).toEqual(["rtk", "read-map"]);
    expect(reviewer?.skills).toEqual(["resolve-conflicts"]);
    expect(reviewer?.extensions).toEqual(["rtk", "read-map"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("preserves omitted vs explicitly empty extensions", () => {
    writeAgent(
      userAgentsDir,
      "default-exts.md",
      [
        "---",
        "name: default-exts",
        "description: Inherit default extensions",
        "---",
        "Use defaults.",
      ].join("\n"),
    );

    writeAgent(
      userAgentsDir,
      "blank-exts.md",
      [
        "---",
        "name: blank-exts",
        "description: Disable all extensions with a blank YAML value",
        "extensions:",
        "---",
        "Disable extensions.",
      ].join("\n"),
    );

    writeAgent(
      userAgentsDir,
      "no-exts.md",
      [
        "---",
        "name: no-exts",
        "description: Disable all extensions",
        "extensions: []",
        "---",
        "Disable extensions.",
      ].join("\n"),
    );

    const { agents } = discoverAgents(nestedProjectCwd, "user");
    const defaultExts = agents.find((agent: { name: string }) => agent.name === "default-exts");
    const blankExts = agents.find((agent: { name: string }) => agent.name === "blank-exts");
    const noExts = agents.find((agent: { name: string }) => agent.name === "no-exts");

    expect(defaultExts?.extensions).toBeUndefined();
    expect(blankExts?.extensions).toEqual([]);
    expect(noExts?.extensions).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats extensions: "" like omission/default behavior without warning', () => {
    writeAgent(
      userAgentsDir,
      "string-empty-exts.md",
      [
        "---",
        "name: string-empty-exts",
        "description: Empty string should not disable extensions",
        'extensions: ""',
        "---",
        "Keep defaults.",
      ].join("\n"),
    );

    const { agents } = discoverAgents(nestedProjectCwd, "user");
    const stringEmptyExts = agents.find((agent: { name: string }) => agent.name === "string-empty-exts");

    expect(stringEmptyExts?.extensions).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps only the first listed skill without warning", () => {
    writeAgent(
      userAgentsDir,
      "reviewer.md",
      [
        "---",
        "name: reviewer",
        "description: Review agent",
        "skills: resolve-conflicts, writing-git-commits",
        "---",
        "Review carefully.",
      ].join("\n"),
    );

    const { agents } = discoverAgents(nestedProjectCwd, "user");
    expect(agents[0]?.skills).toEqual(["resolve-conflicts"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns on invalid skills types but keeps invalid extensions types silent", () => {
    writeAgent(
      userAgentsDir,
      "broken.md",
      [
        "---",
        "name: broken",
        "description: Broken agent",
        "skills:",
        "  nested: nope",
        "extensions:",
        "  enabled: true",
        "---",
        "Broken config.",
      ].join("\n"),
    );

    const { agents } = discoverAgents(nestedProjectCwd, "user");
    expect(agents[0]?.skills).toBeUndefined();
    expect(agents[0]?.extensions).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Ignoring invalid skills field");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Expected a comma-separated string or string array");
  });

  it("lets project agents override user agents while preserving parsed extensions", () => {
    writeAgent(
      userAgentsDir,
      "worker.md",
      [
        "---",
        "name: worker",
        "description: User worker",
        "extensions: user-ext",
        "---",
        "User body.",
      ].join("\n"),
    );

    writeAgent(
      projectAgentsDir,
      "worker.md",
      [
        "---",
        "name: worker",
        "description: Project worker",
        "extensions: project-ext",
        "---",
        "Project body.",
      ].join("\n"),
    );

    const result = discoverAgents(nestedProjectCwd, "both");
    expect(result.projectAgentsDir).toBe(projectAgentsDir);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.source).toBe("project");
    expect(result.agents[0]?.extensions).toEqual(["project-ext"]);
  });
});
