/**
 * Windows Adapter Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../utils/terminal-adapter", () => ({
  execCommand: vi.fn(),
  TerminalAdapter: class {},
}));

import { execCommand } from "../utils/terminal-adapter";
import { WindowsAdapter } from "./windows-adapter";

const mockExecCommand = vi.mocked(execCommand);
const originalPlatform = process.platform;

function decodeUtf16Base64(value: string): string {
  return Buffer.from(value, "base64").toString("utf16le");
}

describe("WindowsAdapter", () => {
  let adapter: WindowsAdapter;

  beforeEach(() => {
    adapter = new WindowsAdapter();
    vi.resetAllMocks();
    vi.clearAllMocks();

    delete process.env.TMUX;
    delete process.env.ZELLIJ;
    delete process.env.WEZTERM_PANE;

    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  it("should have the correct name", () => {
    expect(adapter.name).toBe("Windows");
  });

  describe("detect()", () => {
    it("detects on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      expect(adapter.detect()).toBe(true);
    });

    it("does not detect off Windows", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      expect(adapter.detect()).toBe(false);
    });

    it("does not detect inside tmux", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.TMUX = "1";
      expect(adapter.detect()).toBe(false);
    });

    it("does not detect inside zellij", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.ZELLIJ = "true";
      expect(adapter.detect()).toBe(false);
    });

    it("does not detect inside wezterm", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.WEZTERM_PANE = "123";
      expect(adapter.detect()).toBe(false);
    });
  });

  describe("spawn()", () => {
    it("spawns with split-pane and encoded command", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockExecCommand.mockReturnValueOnce({ stdout: "wt", stderr: "", status: 0 });
      mockExecCommand.mockReturnValueOnce({ stdout: "found", stderr: "", status: 0 });
      mockExecCommand.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      const paneId = adapter.spawn({
        name: "test-agent",
        cwd: "C:/test/path",
        command: "pi --model gpt-4",
        env: { PI_TEAM_NAME: "team1", PI_AGENT_NAME: "agent1" },
      });

      expect(paneId).toMatch(/^windows_\d+_test-agent$/);
      const call = mockExecCommand.mock.calls[2];
      expect(call[0]).toBe("wt");
      expect(call[1].slice(0, 8)).toEqual([
        "-w", "0", "split-pane", "--profile", "pi-teams-pwsh", "--vertical", "--size", "0.5",
      ]);
      expect(call[1][8]).toBe("--");
      expect(call[1][9]).toBe("pwsh");
      expect(call[1][10]).toBe("-EncodedCommand");
      expect(decodeUtf16Base64(call[1][11])).toBe(
        "$env:PI_TEAM_NAME='team1'; $env:PI_AGENT_NAME='agent1'; Set-Location -LiteralPath 'C:/test/path'; pi --model gpt-4"
      );
    });

    it("falls back to horizontal split if vertical fails", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockExecCommand.mockReturnValueOnce({ stdout: "wt", stderr: "", status: 0 });
      mockExecCommand.mockReturnValueOnce({ stdout: "found", stderr: "", status: 0 });
      mockExecCommand.mockReturnValueOnce({ stdout: "", stderr: "vertical failed", status: 1 });
      mockExecCommand.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      const paneId = adapter.spawn({
        name: "test-agent-2",
        cwd: "C:/test/path",
        command: "pi --model gpt-4",
        env: { PI_TEAM_NAME: "team1", PI_AGENT_NAME: "agent1" },
      });

      expect(paneId).toMatch(/^windows_\d+_test-agent-2$/);
      const fallbackCall = mockExecCommand.mock.calls[3];
      expect(fallbackCall[1].slice(0, 8)).toEqual([
        "-w", "0", "split-pane", "--profile", "pi-teams-pwsh", "--horizontal", "--size", "0.5",
      ]);
    });
  });

  describe("supportsWindows()", () => {
    it("returns true on Windows fallback", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockExecCommand.mockReturnValue({ stdout: "", stderr: "", status: 1 });
      expect(adapter.supportsWindows()).toBe(true);
    });
  });

  describe("spawnWindow()", () => {
    it("spawns a new window", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockExecCommand.mockReturnValueOnce({ stdout: "wt", stderr: "", status: 0 });
      mockExecCommand.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      const windowId = adapter.spawnWindow({
        name: "team-lead",
        cwd: "C:/test/path",
        command: "pi",
        env: { PI_TEAM_NAME: "team1", PI_AGENT_NAME: "team-lead" },
        teamName: "team1",
      });

      expect(windowId).toMatch(/^windows_win_title_/);
      const call = mockExecCommand.mock.calls[1];
      expect(call[0]).toBe("wt");
      expect(call[1][0]).toBe("-w");
      expect(call[1][1]).toBe("new");
      expect(call[1][2]).toBe("--profile");
      expect(call[1][3]).toBe("pi-teams-pwsh");
      expect(call[1][4]).toBe("--title");
      expect(call[1][5]).toBe("team1: team-lead");
      expect(call[1][6]).toBe("--");
      expect(call[1][7]).toBe("pwsh");
      expect(call[1][8]).toBe("-EncodedCommand");
      expect(decodeUtf16Base64(call[1][9])).toBe(
        "$env:PI_TEAM_NAME='team1'; $env:PI_AGENT_NAME='team-lead'; Set-Location -LiteralPath 'C:/test/path'; pi"
      );
    });

    it("falls back to powershell when pwsh is not available", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockExecCommand.mockReturnValueOnce({ stdout: "", stderr: "", status: 1 });
      mockExecCommand.mockReturnValueOnce({ stdout: "found", stderr: "", status: 0 });
      mockExecCommand.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      const windowId = adapter.spawnWindow({
        name: "team-lead",
        cwd: "C:/test/path",
        command: "pi",
        env: {},
      });

      expect(windowId).toMatch(/^windows_win_title_/);
      const call = mockExecCommand.mock.calls[2];
      expect(call[0]).toBe("wt");
      expect(call[1][7]).toBe("powershell");
      expect(decodeUtf16Base64(call[1][9])).toBe("Set-Location -LiteralPath 'C:/test/path'; pi");
    });
  });

  it("kill ignores non-windows pane ids", () => {
    adapter.kill("tmux_pane-123");
  });

  it("killWindow ignores non-windows window ids", () => {
    adapter.killWindow("iterm_window-123");
  });

  it("killWindow closes tracked window by title", () => {
    mockExecCommand.mockReturnValueOnce({ stdout: "found", stderr: "", status: 0 });
    mockExecCommand.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    adapter.killWindow("windows_win_title_dGVhbTE6IHRlYW0tbGVhZA");
    expect(mockExecCommand).toHaveBeenNthCalledWith(2, "pwsh", ["-NoProfile", "-Command", expect.stringContaining("FindWindow")]);
  });

  it("isAlive returns true for windows pane ids", () => {
    expect(adapter.isAlive("windows_123_test")).toBe(true);
  });

  it("isAlive returns false for non-windows pane ids", () => {
    expect(adapter.isAlive("tmux_pane-123")).toBe(false);
  });

  it("isWindowAlive returns true for tracked live window ids", () => {
    mockExecCommand.mockReturnValueOnce({ stdout: "found", stderr: "", status: 0 });
    mockExecCommand.mockReturnValueOnce({ stdout: "alive\n", stderr: "", status: 0 });
    expect(adapter.isWindowAlive("windows_win_title_dGVhbTE6IHRlYW0tbGVhZA")).toBe(true);
  });

  it("isWindowAlive returns false for non-windows window ids", () => {
    expect(adapter.isWindowAlive("iterm_window-123")).toBe(false);
  });

  it("setTitle is a no-op", () => {
    adapter.setTitle("anything");
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  it("setWindowTitle is a no-op", () => {
    adapter.setWindowTitle("windows_win_123_test", "New Title");
    expect(mockExecCommand).not.toHaveBeenCalled();
  });
});
