import type { Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, parseKey, truncateToWidth, type TUI } from "@mariozechner/pi-tui";
import type { TaskDetail, TaskRef, TaskStore } from "../state/task-store.js";
import { hotkey, makeChrome, statusLabel } from "./theme.js";
import { renderTranscriptLines } from "./transcript.js";
import { formatModelDisplay } from "../render/format.js";

const MAX_LIST_ROWS = 10;
const MAX_DETAIL_TRANSCRIPT_ROWS = 28;
const DETAIL_AUTO_SCROLL_TOGGLE_KEY = "a";
const TASK_ABORT_CHORD_WINDOW_MS = 900;
type Mode = "list" | "detail";

function oneLine(text: string, max = 120): string {
  const compact = text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function timeAgo(ms: number): string {
  if (!Number.isFinite(ms)) return "-";
  const delta = Math.max(0, Date.now() - ms);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  return `${Math.floor(hour / 24)}d ago`;
}

function elapsed(startedAt: number, endedAt?: number): string {
  if (!Number.isFinite(startedAt)) return "-";
  const end = Number.isFinite(endedAt) ? (endedAt as number) : Date.now();
  const sec = Math.max(0, Math.floor((end - startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hour = Math.floor(min / 60);
  return `${hour}h ${min % 60}m`;
}

function getSiblingOrderedSessionIds(tasks: TaskRef[], sessionId: string): string[] | undefined {
  const selected = tasks.find((task) => task.sessionId === sessionId);
  const groupKey = selected?.taskId;
  if (!groupKey) return undefined;

  const siblingSessionIds = tasks
    .filter((task) => task.taskId === groupKey)
    .sort((a, b) => {
      const ai = a.siblingIndex ?? Number.MAX_SAFE_INTEGER;
      const bi = b.siblingIndex ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.startedAt - b.startedAt;
    })
    .map((task) => task.sessionId);

  return siblingSessionIds.length > 1 ? siblingSessionIds : undefined;
}

export class TasksPanel {
  private mode: Mode = "list";
  private selectedIndex = 0;
  private listScrollOffset = 0;
  private selectedSessionId: string | undefined;
  private detailAutoScrollEnabled = true;
  private readonly detailScrollOffsets = new Map<string, number>();
  private readonly detailMaxScrollOffsets = new Map<string, number>();
  private pendingAbortChordUntil = 0;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly store: TaskStore,
    private readonly abortTaskBySessionId: (sessionId: string) => boolean,
    private readonly done: () => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+c")) {
      this.resetAbortChord();
      this.done();
      return;
    }

    if (this.mode === "list") {
      this.handleListInput(data);
      return;
    }

    this.handleDetailInput(data);
  }

  render(width: number): string[] {
    if (this.mode === "list") return this.renderList(width);
    return this.renderDetail(width);
  }

  invalidate(): void {}

  private handleListInput(data: string): void {
    const tasks = this.store.listTasks();
    if (matchesKey(data, "escape")) {
      this.resetAbortChord();
      this.done();
      return;
    }

    if (tasks.length === 0) {
      this.resetAbortChord();
      return;
    }

    if (this.matchesAbortChord(data)) {
      const selected = tasks[this.selectedIndex];
      if (selected && this.abortTaskBySessionId(selected.sessionId)) {
        this.refresh();
      }
      return;
    }

    if (matchesKey(data, "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.ensureListSelectionVisible(tasks.length);
      this.refresh();
      return;
    }

    if (matchesKey(data, "down")) {
      this.selectedIndex = Math.min(tasks.length - 1, this.selectedIndex + 1);
      this.ensureListSelectionVisible(tasks.length);
      this.refresh();
      return;
    }

    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      const selected = tasks[this.selectedIndex];
      if (!selected) return;
      this.resetAbortChord();
      this.selectedSessionId = selected.sessionId;
      this.mode = "detail";
      this.refresh();
    }
  }

  private handleDetailInput(data: string): void {
    const tasks = this.store.listTasks();
    if (matchesKey(data, "escape")) {
      this.resetAbortChord();
      this.mode = "list";
      this.refresh();
      return;
    }

    if (!this.selectedSessionId || tasks.length === 0) return;

    const index = tasks.findIndex((task) => task.sessionId === this.selectedSessionId);
    if (index < 0) return;

    const sessionId = this.selectedSessionId;
    const maxScroll = this.detailMaxScrollOffsets.get(sessionId) ?? 0;

    if (this.matchesAbortChord(data)) {
      if (this.abortTaskBySessionId(sessionId)) {
        this.refresh();
      }
      return;
    }

    if (this.isAutoScrollToggleKey(data)) {
      this.detailAutoScrollEnabled = !this.detailAutoScrollEnabled;
      if (this.detailAutoScrollEnabled) {
        this.setDetailScrollOffset(sessionId, maxScroll, maxScroll);
      }
      this.refresh();
      return;
    }

    if (!this.detailAutoScrollEnabled && matchesKey(data, "up")) {
      this.setDetailScrollOffset(sessionId, this.getDetailScrollOffset(sessionId) - 1, maxScroll);
      this.refresh();
      return;
    }

    if (!this.detailAutoScrollEnabled && matchesKey(data, "down")) {
      this.setDetailScrollOffset(sessionId, this.getDetailScrollOffset(sessionId) + 1, maxScroll);
      this.refresh();
      return;
    }

    if (!this.detailAutoScrollEnabled && this.isPageUpKey(data)) {
      this.setDetailScrollOffset(sessionId, this.getDetailScrollOffset(sessionId) - MAX_DETAIL_TRANSCRIPT_ROWS, maxScroll);
      this.refresh();
      return;
    }

    if (!this.detailAutoScrollEnabled && this.isPageDownKey(data)) {
      this.setDetailScrollOffset(sessionId, this.getDetailScrollOffset(sessionId) + MAX_DETAIL_TRANSCRIPT_ROWS, maxScroll);
      this.refresh();
      return;
    }

    if (!this.detailAutoScrollEnabled && this.isHomeKey(data)) {
      this.setDetailScrollOffset(sessionId, 0, maxScroll);
      this.refresh();
      return;
    }

    if (!this.detailAutoScrollEnabled && this.isEndKey(data)) {
      this.setDetailScrollOffset(sessionId, maxScroll, maxScroll);
      this.refresh();
      return;
    }

    if (matchesKey(data, "left") || matchesKey(data, "right")) {
      const siblingSessionIds = getSiblingOrderedSessionIds(tasks, this.selectedSessionId);
      const delta = matchesKey(data, "right") ? 1 : -1;

      let nextSessionId: string | undefined;
      if (siblingSessionIds) {
        const siblingIndex = siblingSessionIds.findIndex((candidate) => candidate === this.selectedSessionId);
        if (siblingIndex >= 0) {
          const nextSiblingIndex = Math.max(0, Math.min(siblingSessionIds.length - 1, siblingIndex + delta));
          nextSessionId = siblingSessionIds[nextSiblingIndex];
        }
      }

      if (!nextSessionId) {
        const nextIndex = Math.max(0, Math.min(tasks.length - 1, index + delta));
        nextSessionId = tasks[nextIndex]?.sessionId;
      }

      if (!nextSessionId) return;
      const nextIndex = tasks.findIndex((task) => task.sessionId === nextSessionId);
      if (nextIndex < 0) return;

      this.selectedSessionId = nextSessionId;
      this.selectedIndex = nextIndex;
      this.ensureListSelectionVisible(tasks.length);
      this.refresh();
    }
  }

  private renderList(width: number): string[] {
    const tasks = this.store.listTasks();
    const w = Math.max(86, Math.min(width, 144));
    const innerWidth = Math.max(0, w - 2);
    const th = this.theme;
    const lines: string[] = [];
    const chrome = makeChrome(th, innerWidth);

    lines.push(chrome.top());
    lines.push(
      chrome.row(
        ` ${th.bold(th.fg("accent", "Delegated Tasks"))} ${th.fg("borderMuted", "•")} ${th.fg("muted", `${tasks.length} total`)}`,
      ),
    );
    lines.push(
      chrome.row(
        ` ${hotkey(th, "↑/↓")} ${th.fg("dim", "select")} ${th.fg("borderMuted", "•")} ${hotkey(th, "Enter")} ${th.fg("dim", "open")} ${th.fg("borderMuted", "•")} ${hotkey(th, "DD")} ${th.fg("dim", "abort task")} ${th.fg("borderMuted", "•")} ${hotkey(th, "Esc")} ${th.fg("dim", "close")}`,
      ),
    );
    lines.push(chrome.strongDivider());

    if (tasks.length === 0) {
      lines.push(chrome.row(` ${th.fg("muted", "No delegated tasks recorded in this session.")}`));
      lines.push(chrome.bottom());
      return lines;
    }

    this.selectedIndex = Math.min(this.selectedIndex, tasks.length - 1);
    this.ensureListSelectionVisible(tasks.length);

    const start = this.listScrollOffset;
    const end = Math.min(tasks.length, start + MAX_LIST_ROWS);

    for (let i = start; i < end; i += 1) {
      const task = tasks[i]!;
      lines.push(chrome.row(this.renderListLine(task, i === this.selectedIndex, innerWidth)));
    }

    lines.push(chrome.divider());
    lines.push(
      chrome.row(
        ` ${th.fg("dim", `${this.selectedIndex + 1}/${tasks.length} selected${tasks.length > MAX_LIST_ROWS ? ` • showing ${start + 1}-${end}` : ""}`)}`,
      ),
    );
    lines.push(chrome.bottom());
    return lines;
  }

  private renderListLine(task: TaskRef, selected: boolean, innerWidth: number): string {
    const th = this.theme;
    const marker = selected ? th.fg("accent", "❯") : th.fg("dim", "•");
    const status = statusLabel(th, task.status, selected);
    const meta = `${th.fg("muted", task.sessionId)} ${th.fg("borderMuted", "·")} ${task.agent} ${th.fg("borderMuted", "·")} ${status} ${th.fg("borderMuted", "·")} ${elapsed(task.startedAt, task.finishedAt)} ${th.fg("borderMuted", "·")} ${task.delegationMode}`;
    const summary = oneLine(task.summary, 44);
    const line = selected
      ? ` ${marker} ${th.bold(meta)} ${th.fg("dim", "—")} ${th.bold(summary)}`
      : ` ${marker} ${meta} ${th.fg("dim", "—")} ${th.fg("muted", summary)}`;
    return truncateToWidth(line, innerWidth);
  }

  private renderDetail(width: number): string[] {
    const tasks = this.store.listTasks();
    const selectedId = this.selectedSessionId ?? tasks[this.selectedIndex]?.sessionId;
    const th = this.theme;

    const w = Math.max(90, Math.min(width, 148));
    const innerWidth = Math.max(0, w - 2);
    const lines: string[] = [];
    const chrome = makeChrome(th, innerWidth);

    lines.push(chrome.top());

    if (!selectedId) {
      lines.push(chrome.row(` ${th.fg("muted", "No task selected.")}`));
      lines.push(chrome.bottom());
      return lines;
    }

    const detail = this.store.getTaskDetail(selectedId);
    if (!detail) {
      lines.push(chrome.row(` ${th.fg("warning", "Task not found.")}`));
      lines.push(chrome.bottom());
      return lines;
    }

    const currentIndex = tasks.findIndex((task) => task.sessionId === detail.sessionId);
    const siblingTasks = detail.ref.taskId
      ? tasks
        .filter((task) => task.taskId === detail.ref.taskId)
        .sort((a, b) => {
          const ai = a.siblingIndex ?? Number.MAX_SAFE_INTEGER;
          const bi = b.siblingIndex ?? Number.MAX_SAFE_INTEGER;
          if (ai !== bi) return ai - bi;
          return a.startedAt - b.startedAt;
        })
      : [];
    const siblingIndex = siblingTasks.findIndex((entry) => entry.sessionId === detail.sessionId);
    const idxText = siblingIndex >= 0
      ? `${siblingIndex + 1}/${siblingTasks.length}`
      : currentIndex >= 0
      ? `${currentIndex + 1}/${tasks.length}`
      : "-/-";
    const sessionId = detail.sessionId || detail.result?.sessionId || "-";
    const taskId = detail.ref.taskId || detail.result?.taskId || "-";
    const siblingIndexLabel = typeof detail.ref.siblingIndex === "number" ? String(detail.ref.siblingIndex) : "-";
    const model = formatModelDisplay(detail.ref.model, detail.ref.provider) || "-";

    lines.push(
      chrome.row(
        ` ${th.fg("dim", "mode")} ${detail.ref.delegationMode} ${th.fg("borderMuted", "•")} ${th.fg("dim", "elapsed")} ${elapsed(detail.ref.startedAt, detail.ref.finishedAt)} ${th.fg("borderMuted", "•")} ${th.fg("dim", "updated")} ${timeAgo(detail.ref.updatedAt)} ${th.fg("borderMuted", "•")} ${statusLabel(th, detail.ref.status, true)} ${th.fg("borderMuted", "•")} ${th.fg("muted", idxText)} ${th.fg("borderMuted", "•")} ${detail.ref.agent}`,
      ),
    );
    lines.push(
      chrome.row(` ${th.fg("dim", "session")} ${th.fg("muted", sessionId)} ${th.fg("borderMuted", "•")} ${th.fg("dim", "taskId")} ${th.fg("muted", taskId)} ${th.fg("borderMuted", "•")} ${th.fg("dim", "sibling")} ${th.fg("muted", siblingIndexLabel)} ${th.fg("borderMuted", "•")} ${th.fg("dim", "model")} ${th.fg("muted", model)}`),
    );

    lines.push(chrome.strongDivider());

    const transcriptLines = this.renderDetailTranscriptLines(detail, innerWidth);
    const maxScroll = Math.max(0, transcriptLines.length - MAX_DETAIL_TRANSCRIPT_ROWS);
    this.detailMaxScrollOffsets.set(detail.sessionId, maxScroll);

    const scrollOffset = this.detailAutoScrollEnabled
      ? maxScroll
      : Math.min(this.getDetailScrollOffset(detail.sessionId), maxScroll);
    this.detailScrollOffsets.set(detail.sessionId, scrollOffset);

    const start = scrollOffset;
    const end = Math.min(transcriptLines.length, start + MAX_DETAIL_TRANSCRIPT_ROWS);

    for (let i = start; i < end; i += 1) {
      lines.push(chrome.row(transcriptLines[i] ?? ""));
    }

    for (let i = end - start; i < MAX_DETAIL_TRANSCRIPT_ROWS; i += 1) {
      lines.push(chrome.row(""));
    }

    lines.push(chrome.divider());
    const autoScrollText = this.detailAutoScrollEnabled
      ? "Auto-scroll ON"
      : "Auto-scroll OFF • ↑/↓/PgUp/PgDn/Home/End scroll";
    lines.push(
      chrome.row(
        ` ${th.fg("dim", "←/→")} switch tasks • ${hotkey(th, "DD")} abort task • ${hotkey(th, DETAIL_AUTO_SCROLL_TOGGLE_KEY.toUpperCase())} toggle • ${hotkey(th, "Esc")} back • ${autoScrollText} • ${transcriptLines.length === 0 ? "0/0" : `${start + 1}-${Math.max(start + 1, end)}/${transcriptLines.length}`}`,
      ),
    );

    lines.push(chrome.bottom());
    return lines;
  }

  private renderDetailTranscriptLines(detail: TaskDetail, innerWidth: number): string[] {
    return renderTranscriptLines(detail, innerWidth, this.theme);
  }

  private getDetailScrollOffset(sessionId: string): number {
    return this.detailScrollOffsets.get(sessionId) ?? 0;
  }

  private setDetailScrollOffset(sessionId: string, nextOffset: number, maxScroll: number): void {
    const clamped = Math.max(0, Math.min(nextOffset, Math.max(0, maxScroll)));
    this.detailScrollOffsets.set(sessionId, clamped);
  }

  private isAutoScrollToggleKey(data: string): boolean {
    return matchesKey(data, DETAIL_AUTO_SCROLL_TOGGLE_KEY);
  }

  private isPageUpKey(data: string): boolean {
    const key = (parseKey(data) ?? "").toLowerCase();
    return matchesKey(data, "pageUp") || key === "page_up" || key === "prior" || key.endsWith("+pageup")
      || key.endsWith("+page_up") || key.endsWith("+prior") || matchesKey(data, "ctrl+b");
  }

  private isPageDownKey(data: string): boolean {
    const key = (parseKey(data) ?? "").toLowerCase();
    return matchesKey(data, "pageDown") || key === "page_down" || key === "next" || key.endsWith("+pagedown")
      || key.endsWith("+page_down") || key.endsWith("+next") || matchesKey(data, "ctrl+f");
  }

  private isHomeKey(data: string): boolean {
    return matchesKey(data, "home") || matchesKey(data, "ctrl+a");
  }

  private isEndKey(data: string): boolean {
    return matchesKey(data, "end") || matchesKey(data, "ctrl+e");
  }

  private matchesAbortChord(data: string): boolean {
    if (!matchesKey(data, "d")) {
      this.resetAbortChord();
      return false;
    }

    const now = Date.now();
    const matched = this.pendingAbortChordUntil > now;
    this.pendingAbortChordUntil = matched ? 0 : now + TASK_ABORT_CHORD_WINDOW_MS;
    return matched;
  }

  private resetAbortChord(): void {
    this.pendingAbortChordUntil = 0;
  }

  private ensureListSelectionVisible(total: number): void {
    const visible = Math.min(MAX_LIST_ROWS, total);
    if (this.selectedIndex < this.listScrollOffset) {
      this.listScrollOffset = this.selectedIndex;
      return;
    }
    if (this.selectedIndex >= this.listScrollOffset + visible) {
      this.listScrollOffset = this.selectedIndex - visible + 1;
      return;
    }
    const maxScroll = Math.max(0, total - visible);
    this.listScrollOffset = Math.max(0, Math.min(this.listScrollOffset, maxScroll));
  }

  private refresh(): void {
    this.tui.requestRender();
  }
}
