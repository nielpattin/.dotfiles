import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const testRootDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-pi-subagent-agents-test-"));
const testHomeDir = path.join(testRootDir, "home");
const userAgentsDir = path.join(testHomeDir, ".pi", "agent", "agents");
const projectRootDir = path.join(testRootDir, "repo");
const projectAgentsDir = path.join(projectRootDir, ".pi", "agents");
const nestedProjectCwd = path.join(projectRootDir, "packages", "app");

process.env.PI_SUBAGENT_TEST_HOME = testHomeDir;

vi.mock("node:os", async (importActual) => {
  const actual = await importActual<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => process.env.PI_SUBAGENT_TEST_HOME ?? actual.homedir(),
  };
});

let warnSpy: ReturnType<typeof vi.spyOn>;
const { discoverAgents } = await import("./agents/discover.ts");
const { updateAgentDefaultsInFile } = await import("./agents/update.ts");

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
  delete process.env.PI_SUBAGENT_TEST_HOME;
  fs.rmSync(testRootDir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(userAgentsDir, { recursive: true, force: true });
  fs.rmSync(projectAgentsDir, { recursive: true, force: true });
  fs.mkdirSync(userAgentsDir, { recursive: true });
  fs.mkdirSync(projectAgentsDir, { recursive: true });
  warnSpy?.mockRestore();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("discoverAgents frontmatter parsing", () => {
  it("parses skill/skills aliases plus extensions from strings and yaml arrays", () => {
    writeAgent(
      userAgentsDir,
      "designer.md",
      [
        "---",
        "name: designer",
        "description: UI agent",
        "skill: ui-design",
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
        "  - writing-git-commits",
        "extensions:",
        "  - rtk",
        "  - read-map",
        "---",
        "Review carefully.",
      ].join("\n"),
    );

    const { agents } = discoverAgents(nestedProjectCwd, "user");
    const designer = agents.find((agent) => agent.name === "designer");
    const reviewer = agents.find((agent) => agent.name === "reviewer");

    expect(designer?.skills).toEqual(["ui-design"]);
    expect(designer?.extensions).toEqual(["rtk", "read-map"]);
    expect(reviewer?.skills).toEqual(["resolve-conflicts", "writing-git-commits"]);
    expect(reviewer?.extensions).toEqual(["rtk", "read-map"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("prefers the plural skills alias when both aliases are present", () => {
    writeAgent(
      userAgentsDir,
      "reviewer.md",
      [
        "---",
        "name: reviewer",
        "description: Review agent",
        "skill: triage-expert",
        "skills: resolve-conflicts, writing-git-commits",
        "---",
        "Review carefully.",
      ].join("\n"),
    );

    const { agents } = discoverAgents(nestedProjectCwd, "user");
    expect(agents[0]?.skills).toEqual(["resolve-conflicts", "writing-git-commits"]);
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
    const defaultExts = agents.find((agent) => agent.name === "default-exts");
    const blankExts = agents.find((agent) => agent.name === "blank-exts");
    const noExts = agents.find((agent) => agent.name === "no-exts");

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
    const stringEmptyExts = agents.find((agent) => agent.name === "string-empty-exts");

    expect(stringEmptyExts?.extensions).toBeUndefined();
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
        "skill:",
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

  it("lets project agents override user agents while preserving parsed extensions and skills", () => {
    writeAgent(
      userAgentsDir,
      "worker.md",
      [
        "---",
        "name: worker",
        "description: User worker",
        "skill: triage-expert",
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
        "skills: resolve-conflicts, writing-git-commits",
        "extensions: project-ext",
        "---",
        "Project body.",
      ].join("\n"),
    );

    const result = discoverAgents(nestedProjectCwd, "both");
    expect(result.projectAgentsDir).toBe(projectAgentsDir);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.source).toBe("project");
    expect(result.agents[0]?.skills).toEqual(["resolve-conflicts", "writing-git-commits"]);
    expect(result.agents[0]?.extensions).toEqual(["project-ext"]);
  });
});

describe("updateAgentDefaultsInFile", () => {
  it("persists multi-skill defaults, extensions, and cwd into agent frontmatter", () => {
    const agentPath = writeAgent(
      userAgentsDir,
      "writer.md",
      [
        "---",
        "name: writer",
        "description: Writes docs",
        "---",
        "Body.",
      ].join("\n"),
    );

    updateAgentDefaultsInFile(agentPath, {
      defaultSkills: ["triage-expert", "frontend-design"],
      enabledExtensions: ["rtk", "read-map"],
      defaultCwd: "/repo/docs",
    });

    const { agents } = discoverAgents(nestedProjectCwd, "user");
    const writer = agents.find((agent) => agent.name === "writer");
    const raw = fs.readFileSync(agentPath, "utf-8");

    expect(writer?.skills).toEqual(["triage-expert", "frontend-design"]);
    expect(writer?.extensions).toEqual(["rtk", "read-map"]);
    expect(writer?.cwd).toBe("/repo/docs");
    expect(raw).toContain("skills:");
    expect(raw).toContain('cwd: "/repo/docs"');
  });

  it("clears defaults from frontmatter when null updates are provided", () => {
    const agentPath = writeAgent(
      userAgentsDir,
      "cleanup.md",
      [
        "---",
        "name: cleanup",
        "description: Cleanup agent",
        "skills: triage-expert, frontend-design",
        "extensions: rtk, read-map",
        "cwd: /repo/app",
        "---",
        "Body.",
      ].join("\n"),
    );

    updateAgentDefaultsInFile(agentPath, {
      defaultSkills: null,
      enabledExtensions: null,
      defaultCwd: null,
    });

    const { agents } = discoverAgents(nestedProjectCwd, "user");
    const cleanup = agents.find((agent) => agent.name === "cleanup");
    const raw = fs.readFileSync(agentPath, "utf-8");

    expect(cleanup?.skills).toBeUndefined();
    expect(cleanup?.extensions).toBeUndefined();
    expect(cleanup?.cwd).toBeUndefined();
    expect(raw).not.toContain("skills:");
    expect(raw).not.toContain("extensions:");
    expect(raw).not.toContain("cwd:");
  });
});
