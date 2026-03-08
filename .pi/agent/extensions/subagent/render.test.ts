import { describe, expect, it, mock } from "bun:test";

class Text {
  constructor(
    public text: string,
    public x: number,
    public y: number,
  ) {}
}

class Container {
  children: any[] = [];

  addChild(child: any): void {
    this.children.push(child);
  }
}

class Spacer {
  constructor(public size: number) {}
}

class Markdown {
  constructor(
    public text: string,
    public x: number,
    public y: number,
    public theme: unknown,
  ) {}
}

mock.module("@mariozechner/pi-ai", () => ({
  getModels() {
    return [{ id: "gpt-5.4", name: "OpenAI: GPT-5.4" }];
  },
}));

mock.module("@mariozechner/pi-coding-agent", () => ({
  getMarkdownTheme() {
    return { name: "mock-markdown-theme" };
  },
  keyHint(_action: string, fallback: string) {
    return fallback;
  },
  loadSkills() {
    return { skills: [] };
  },
  stripFrontmatter(content: string) {
    return content.replace(/^---[\s\S]*?---\s*/, "");
  },
}));

mock.module("@mariozechner/pi-tui", () => ({
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth(text: string, width: number) {
    return text.length > width ? text.slice(0, width) : text;
  },
  visibleWidth(text: string) {
    return text.replace(/\x1b\[[0-9;]*m/g, "").length;
  },
}));

// @ts-expect-error test-only query string keeps this import isolated from other test modules
const { renderResult } = await import("./render.ts?render-test");
const { emptyUsage } = await import("./types.ts");

function makeTheme() {
  return {
    fg(_color: string, text: string) {
      return text;
    },
    bold(text: string) {
      return text;
    },
  };
}

function makeResult(overrides: Record<string, any> = {}) {
  const now = Date.now();
  return {
    agent: "worker",
    agentSource: "user",
    task: "Default task",
    summary: "Default summary",
    delegationMode: "spawn",
    exitCode: 0,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      },
    ],
    stderr: "",
    usage: emptyUsage(),
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDetails(results: any[], mode: "single" | "parallel" = "single") {
  return {
    mode,
    delegationMode: "spawn" as const,
    projectAgentsDir: null,
    results,
  };
}

function makeToolResult(details: any) {
  return {
    content: [{ type: "text", text: "" }],
    details,
  };
}

function renderSummaryLines(result: any): string[] {
  return result.render(120);
}

function collectRenderableText(node: any): string[] {
  if (!node) return [];
  if (node instanceof Text) return [node.text];
  if (node instanceof Markdown) return [node.text];
  if (node instanceof Spacer) return [];
  if (node instanceof Container) {
    return node.children.flatMap((child) => collectRenderableText(child));
  }
  return [];
}

describe("subagent render", () => {
  it("renders collapsed single cards with task previews for running, failed, and completed states", () => {
    const theme = makeTheme();

    const running = renderResult(
      makeToolResult(makeDetails([
        makeResult({ exitCode: -1, messages: [] }),
      ])),
      false,
      true,
      theme as any,
    );
    const runningLines = renderSummaryLines(running);
    expect(runningLines.join("\n")).toContain("Task: Default task");
    expect(runningLines.join("\n")).toContain("Current: waiting for first tool call");
    expect(runningLines.join("\n")).toContain("Source: spawn");

    const failed = renderResult(
      makeToolResult(makeDetails([
        makeResult({
          exitCode: 1,
          stopReason: "error",
          failureCategory: "startup",
          errorMessage: "Task blew up.",
          messages: [],
        }),
      ])),
      false,
      false,
      theme as any,
    );
    const failedLines = renderSummaryLines(failed);
    expect(failedLines.join("\n")).toContain("✕ ");
    expect(failedLines.join("\n")).toContain("Worker — Default summary");
    expect(failedLines.join("\n")).toContain("Task: Default task");
    expect(failedLines.join("\n")).not.toContain("startup failed");
    expect(failedLines.join("\n")).toContain("Startup failure: Task blew up.");

    const completed = renderResult(
      makeToolResult(makeDetails([
        makeResult({
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "finished successfully" }],
            },
          ],
        }),
      ])),
      false,
      false,
      theme as any,
    );
    const completedLines = renderSummaryLines(completed);
    expect(completedLines.join("\n")).toContain("Task: Default task");
    expect(completedLines.join("\n")).toContain("Done");
    expect(completedLines.join("\n")).toContain("Result: finished successfully");
  });

  it("keeps failed card titles stable and moves abort status out of the summary row", () => {
    const theme = {
      fg(color: string, text: string) {
        return `<${color}>${text}</${color}>`;
      },
      bold(text: string) {
        return text;
      },
    };

    const rendered = renderResult(
      makeToolResult(makeDetails([
        makeResult({
          exitCode: 130,
          stopReason: "aborted",
          failureCategory: "abort",
          errorMessage: "Task was aborted.",
          messages: [],
        }),
      ])),
      false,
      false,
      theme as any,
    );

    const lines = rendered.render(500);
    expect(lines[0]).toContain("<error>✕ </error>");
    expect(lines[0]).not.toContain("aborted");
    expect(lines[0]).not.toContain("<error># Worker — Default summary</error>");
    expect(lines.join("\n")).toContain("Aborted: Task was aborted.");
  });

  it("collapses multiline task previews to one line in narrow cards", () => {
    const theme = makeTheme();
    const rendered = renderResult(
      makeToolResult(makeDetails([
        makeResult({
          task: "  Investigate\n\nsubagent render.ts\tpreview handling  ",
          messages: [],
        }),
      ])),
      false,
      false,
      theme as any,
    );

    const lines = rendered.render(26).join("\n");
    expect(lines).toContain("Task: Investigate suba");
    expect(lines).not.toContain("\n\n");
  });

  it("renders expanded single results with task, skills, tool trace, and output sections", () => {
    const theme = makeTheme();
    const rendered = renderResult(
      makeToolResult(makeDetails([
        makeResult({
          task: "Review src/index.ts",
          summary: "Review task",
          skillLoad: {
            lookupCwd: "C:/repo",
            requested: ["code-review", "missing-skill"],
            loaded: ["code-review"],
            missing: ["missing-skill"],
            warnings: ["Skill not found for agent \"worker\": missing-skill"],
          },
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  name: "read",
                  arguments: { path: "src/index.ts" },
                },
              ],
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "Final answer" }],
            },
          ],
        }),
      ])),
      true,
      false,
      theme as any,
    );

    const text = collectRenderableText(rendered).join("\n");
    expect(text).toContain("─── Task ───");
    expect(text).toContain("Review src/index.ts");
    expect(text).toContain("─── Skills ───");
    expect(text).toContain("requested: code-review, missing-skill");
    expect(text).toContain("loaded: code-review");
    expect(text).toContain("missing: missing-skill");
    expect(text).toContain("Skill not found for agent \"worker\": missing-skill");
    expect(text).toContain("─── Tool Trace ───");
    expect(text).toContain("read src/index.ts");
    expect(text).toContain("─── Output ───");
    expect(text).toContain("Final answer");
  });

  it("renders failure categories distinctly from raw error text in expanded details", () => {
    const theme = makeTheme();
    const rendered = renderResult(
      makeToolResult(makeDetails([
        makeResult({
          exitCode: 1,
          stopReason: "error",
          failureCategory: "runtime",
          errorMessage: "Command exited with status 7.",
          messages: [],
        }),
      ])),
      true,
      false,
      theme as any,
    );

    const text = collectRenderableText(rendered).join("\n");
    expect(text).toContain("Failure category: runtime");
    expect(text).toContain("Error: Command exited with status 7.");
  });

  it("renders collapsed parallel summaries with task previews and hidden task counts", () => {
    const theme = makeTheme();
    const rendered = renderResult(
      makeToolResult(
        makeDetails(
          [
            makeResult({ agent: "worker", summary: "One", task: "Inspect src/index.ts" }),
            makeResult({ agent: "reviewer", summary: "Two", task: "Review the failing tests" }),
            makeResult({ agent: "planner", summary: "Three", task: "Outline the rollout plan" }),
            makeResult({ agent: "writer", summary: "Four", task: "Draft the changelog entry" }),
            makeResult({ agent: "tester", summary: "Five", task: "Verify the hidden fifth card" }),
          ],
          "parallel",
        ),
      ),
      false,
      false,
      theme as any,
    );

    const lines = renderSummaryLines(rendered).join("\n");
    expect(lines).toContain("Worker — One");
    expect(lines).toContain("Task: Inspect src/index.ts");
    expect(lines).toContain("Task: Draft the changelog entry");
    expect(lines).toContain("1 more task");
    expect(lines).not.toContain("Tester — Five");
    expect(lines).not.toContain("Task: Verify the hidden fifth card");
  });

  it("renders per-task delegation modes for mixed parallel batches", () => {
    const theme = makeTheme();
    const rendered = renderResult(
      makeToolResult(
        makeDetails(
          [
            makeResult({ agent: "worker", summary: "One", delegationMode: "spawn" }),
            makeResult({ agent: "reviewer", summary: "Two", delegationMode: "fork" }),
          ],
          "parallel",
        ),
      ),
      false,
      false,
      theme as any,
    );

    const lines = renderSummaryLines(rendered).join("\n");
    expect(lines).toContain("Source: spawn");
    expect(lines).toContain("Source: fork");
  });
});
