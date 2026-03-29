import { describe, expect, test, vi } from "vitest";

import {
  createPowerShellToolDefinition,
  findPowerShell,
  formatPowerShellCall,
  formatPowerShellCwd,
  renderPowerShellCall,
  rewriteBashPrompt,
} from "./index";

describe("findPowerShell", () => {
  test("prefers pwsh when available", () => {
    const probe = vi.fn(() => "PowerShell 7");

    expect(findPowerShell(probe)).toBe("pwsh");
    expect(probe).toHaveBeenCalledWith("pwsh -Version", { stdio: "ignore" });
  });

  test("falls back to powershell.exe when pwsh is unavailable", () => {
    const probe = vi.fn(() => {
      throw new Error("missing");
    });

    expect(findPowerShell(probe)).toBe("powershell.exe");
  });
});

describe("formatPowerShellCwd", () => {
  test("shows home as tilde", () => {
    expect(formatPowerShellCwd("C:/Users/niel", "C:/Users/niel")).toBe("~");
  });

  test("shows subdirectories under home with tilde prefix", () => {
    expect(formatPowerShellCwd("C:/Users/niel/work", "C:/Users/niel")).toBe("~\\work");
  });
});

describe("formatPowerShellCall", () => {
  test("includes cwd and timeout", () => {
    expect(formatPowerShellCall({ command: "Get-Location", timeout: 5 }, "C:/work")).toBe(
      "PS C:/work> Get-Location (timeout 5s)",
    );
  });
});

describe("rewriteBashPrompt", () => {
  test("replaces bash file operation guidance", () => {
    const prompt = "Use bash for file operations like ls, rg, find";

    expect(rewriteBashPrompt(prompt)).toBe(
      "Use powershell for file operations like Get-ChildItem, Select-String, Get-ChildItem -Recurse",
    );
  });
});

describe("renderPowerShellCall", () => {
  test("shows cwd and command", () => {
    const component = renderPowerShellCall(
      { command: "Get-Location", timeout: 3 },
      {
        fg: (_token: string, text: string) => text,
        bold: (text: string) => text,
      } as never,
      {
        lastComponent: undefined,
        cwd: "C:/work",
      },
    );

    expect(component.render(120).join("\n")).toContain("PS C:/work> Get-Location (timeout 3s)");
  });
});

describe("createPowerShellToolDefinition", () => {
  test("executes through provided operations and keeps bash-style result handling", async () => {
    const exec = vi.fn(async (_command: string, _cwd: string, options: { onData: (data: Buffer) => void }) => {
      options.onData(Buffer.from("hello from pwsh\n"));
      return { exitCode: 0 };
    });

    const tool = createPowerShellToolDefinition("C:/work", {
      operations: { exec },
    });

    const result = await tool.execute(
      "tool-1",
      { command: "Get-Location" },
      undefined,
      undefined,
      {} as never,
    );

    expect(exec).toHaveBeenCalledWith(
      "Get-Location",
      "C:/work",
      expect.objectContaining({ timeout: undefined }),
    );

    const [content] = result.content;
    expect(content?.type).toBe("text");
    if (!content || content.type !== "text") {
      throw new Error("expected text content");
    }
    expect(content.text).toContain("hello from pwsh");
  });
});
