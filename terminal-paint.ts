#!/usr/bin/env bun
// @ts-nocheck
import { stdin, stdout } from "node:process";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

// Terminal size
let cols = stdout.columns ?? 80;
let rows = stdout.rows ?? 24;

// Painted cell: { ch: character, color: 256-color fg index }
interface Cell {
  ch: string;
  color: number;
  baseColor?: number;
}
const canvas = new Map<string, Cell>();

// Editor state
type Tool = "brush" | "box" | "line" | "text" | "eraser" | "select";
let tool: Tool = "select";

const STATE_FILE = path.join(process.cwd(), ".terminal-paint-state.json");

let recentArts: string[] = [];
let appState: "launcher" | "editor" = "launcher";
let launcherSelection = 0;
let lastClickTime = 0;
let lastClickX = 0;
let lastClickY = 0;

let savingMode = false;
let saveFilename = "";
let currentOpenFile = "";

let deleteConfirmIdx: number | null = null;

let clipboardCells = new Map<string, Cell>();
let clipboardRect: { w: number, h: number } | null = null;

let linePreviewCells = new Set<string>();
let boxPreviewCells = new Map<string, string>();

function updatePreviewCells(): void {
  linePreviewCells.clear();
  boxPreviewCells.clear();
  
  if (!active) return;
  
  if (tool === "line") {
    let x0 = Math.max(5, Math.min(cols, startX));
    let y0 = Math.max(statusHeight + 1, Math.min(rows, startY));
    let x1 = Math.max(5, Math.min(cols, hoverX));
    let y1 = Math.max(statusHeight + 1, Math.min(rows, hoverY));
    
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    
    while (true) {
      linePreviewCells.add(cellKey(x0, y0));
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  } else if (tool === "box") {
    const left = Math.max(5, Math.min(startX, hoverX));
    const right = Math.min(cols, Math.max(startX, hoverX));
    const top = Math.max(statusHeight + 1, Math.min(startY, hoverY));
    const bottom = Math.min(rows, Math.max(startY, hoverY));
    
    for (let x = left; x <= right; x++) {
      boxPreviewCells.set(cellKey(x, top), "─");
      boxPreviewCells.set(cellKey(x, bottom), "─");
    }
    for (let y = top; y <= bottom; y++) {
      boxPreviewCells.set(cellKey(left, y), "│");
      boxPreviewCells.set(cellKey(right, y), "│");
    }
    boxPreviewCells.set(cellKey(left, top), "┌");
    boxPreviewCells.set(cellKey(right, top), "┐");
    boxPreviewCells.set(cellKey(left, bottom), "└");
    boxPreviewCells.set(cellKey(right, bottom), "┘");
  }
}

function loadState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.recentChars)) {
        recentChars.length = 0;
        recentChars.push(...data.recentChars);
      }
      if (Array.isArray(data.recentArts)) {
        recentArts = data.recentArts;
      }
    }
  } catch (err) {
    // Ignore
  }
}

function saveState(): void {
  try {
    const data = {
      recentChars,
      recentArts,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data), "utf8");
  } catch (err) {
    // Ignore
  }
}

function addRecentArt(filePath: string): void {
  try {
    const normPath = path.normalize(filePath);
    const idx = recentArts.indexOf(normPath);
    if (idx !== -1) {
      recentArts.splice(idx, 1);
    }
    recentArts.unshift(normPath);
    if (recentArts.length > 20) {
      recentArts.pop();
    }
    currentOpenFile = normPath;
    saveState();
  } catch (err) {
    // Ignore
  }
}

function selectLauncherOption(): void {
  const options = ["+ Create New Drawing", ...recentArts];
  const choice = options[launcherSelection];
  if (choice === "+ Create New Drawing") {
    canvas.clear();
    currentOpenFile = "";
    appState = "editor";
    panX = 0;
    panY = 0;
    lastClickCanvasX = -1;
    lastClickCanvasY = -1;
    prevScreen = null;
    draw();
  } else {
    try {
      if (fs.existsSync(choice)) {
        const raw = fs.readFileSync(choice, "utf8");
        const data = JSON.parse(raw);
        canvas.clear();
        for (const [k, v] of data) {
          canvas.set(k, v);
        }
        currentOpenFile = choice;
        appState = "editor";
        panX = 0;
        panY = 0;
        lastClickCanvasX = -1;
        lastClickCanvasY = -1;
        prevScreen = null;
        draw();
      } else {
        const idx = recentArts.indexOf(choice);
        if (idx !== -1) {
          recentArts.splice(idx, 1);
          saveState();
        }
        draw();
      }
    } catch (err) {
      draw();
    }
  }
}

function handleLauncherDelete(): void {
  if (launcherSelection === 0) return;
  const choice = recentArts[launcherSelection - 1];
  if (!choice) return;
  
  if (deleteConfirmIdx === launcherSelection) {
    try {
      if (fs.existsSync(choice)) {
        fs.unlinkSync(choice);
      }
    } catch (err) {
      // Ignore
    }
    recentArts.splice(launcherSelection - 1, 1);
    launcherSelection = Math.min(launcherSelection, recentArts.length);
    deleteConfirmIdx = null;
    saveState();
    prevScreen = null;
    draw();
  } else {
    deleteConfirmIdx = launcherSelection;
    draw();
  }
}

function executeSave(filename: string): void {
  try {
    if (!filename.endsWith(".json")) {
      filename += ".json";
    }
    const serialized = JSON.stringify(Array.from(canvas.entries()), null, 2);
    fs.writeFileSync(filename, serialized, "utf8");
    
    const normPath = path.resolve(filename);
    const idx = recentArts.indexOf(normPath);
    if (idx !== -1) {
      recentArts.splice(idx, 1);
    }
    recentArts.unshift(normPath);
    if (recentArts.length > 20) {
      recentArts.pop();
    }
    currentOpenFile = normPath;
    saveState();
  } catch (err) {
    // Ignore
  }
}

let selectionActive = false;
let selectionRect: { x0: number, y0: number, x1: number, y1: number } | null = null;
let movingSelection = false;
let selectionCells = new Map<string, Cell>();
let moveStart: { x: number, y: number } | null = null;
let moveOffset: { dx: number, dy: number } = { dx: 0, dy: 0 };

function commitSelection(): void {
  if (selectionActive) {
    pushUndo();
    for (const [k, v] of selectionCells) {
      const coords = k.split(",").map(Number);
      canvas.set(cellKey(coords[0], coords[1]), {
        ch: v.ch,
        color: v.color,
        baseColor: v.baseColor ?? v.color
      });
    }
    selectionActive = false;
    selectionRect = null;
    selectionCells.clear();
  }
}

function getSelectionBorderChar(x: number, y: number, left: number, right: number, top: number, bottom: number): string {
  if (x === left && y === top) return "┌";
  if (x === right && y === top) return "┐";
  if (x === left && y === bottom) return "└";
  if (x === right && y === bottom) return "┘";
  if (x === left || x === right) return "│";
  if (y === top || y === bottom) return "─";
  return " ";
}
type GridStyle = "dot" | "line" | "none";
let gridStyle: GridStyle = "dot";
let gridOpacity = 2;
const OPACITY_COLORS: Record<number, number> = {
  1: 233,
  2: 236,
  3: 240,
  4: 244,
  5: 248,
};
function getGridColor(): string {
  const op = selectionActive ? 1 : gridOpacity;
  const fg = OPACITY_COLORS[op] ?? 236;
  return `${fg256(fg)}${bg256(232)}`;
}

let brushOpacity = 5;
let boxOpacity = 5;
let lineOpacity = 5;
let textOpacity = 5;
let selectOpacity = 5;
let opacityTarget: "brush" | "box" | "line" | "text" | "grid" | "select" = "select";

let panX = 0;
let panY = 0;
let panning = false;
let panStart = { x: 0, y: 0 };
let originalPan = { x: 0, y: 0 };
let lastClickCanvasX = -1;
let lastClickCanvasY = -1;

function updateSelectionColor(newColor: number): void {
  if (selectionActive && selectionCells.size > 0) {
    const opacity = getCurrentOpacity();
    for (const cell of selectionCells.values()) {
      cell.baseColor = newColor;
      cell.color = adjustColorOpacity(newColor, opacity);
    }
  }
}

function updateSelectionOpacity(): void {
  if (selectionActive && selectionCells.size > 0) {
    const opacity = getCurrentOpacity();
    for (const cell of selectionCells.values()) {
      const base = cell.baseColor ?? cell.color;
      cell.color = adjustColorOpacity(base, opacity);
      cell.baseColor = base;
    }
  }
}

function getCurrentOpacity(): number {
  if (opacityTarget === "brush") return brushOpacity;
  if (opacityTarget === "box") return boxOpacity;
  if (opacityTarget === "line") return lineOpacity;
  if (opacityTarget === "text") return textOpacity;
  if (opacityTarget === "select") return selectOpacity;
  return gridOpacity;
}

function setCurrentOpacity(value: number): void {
  if (opacityTarget === "brush") brushOpacity = value;
  else if (opacityTarget === "box") boxOpacity = value;
  else if (opacityTarget === "line") lineOpacity = value;
  else if (opacityTarget === "text") textOpacity = value;
  else if (opacityTarget === "select") selectOpacity = value;
  else gridOpacity = value;
  updateSelectionOpacity();
}

const OPACITY_FACTORS = [0.30, 0.45, 0.60, 0.80, 1.00];

function adjustColorOpacity(c: number, opacity: number): number {
  if (opacity === 5) return c;
  const factor = OPACITY_FACTORS[opacity - 1] ?? 1.0;
  if (c === 255) {
    const scaledLevel = Math.round(23 * factor);
    return 232 + scaledLevel;
  }
  if (c >= 232 && c <= 255) {
    const level = c - 232;
    const scaledLevel = Math.round(level * factor);
    return 232 + scaledLevel;
  }
  if (c >= 16 && c <= 231) {
    const offset = c - 16;
    const r = Math.floor(offset / 36);
    const g = Math.floor((offset % 36) / 6);
    const b = offset % 6;
    const scaledR = Math.round(r * factor);
    const scaledG = Math.round(g * factor);
    const scaledB = Math.round(b * factor);
    return 16 + 36 * scaledR + 6 * scaledG + scaledB;
  }
  return c;
}

let brush = "#";
let color = 255;
let hoverX = Math.max(5, Math.floor(cols / 2));
let hoverY = Math.max(2, 2 + Math.floor((rows - 2) / 2));
let startX = 0;
let startY = 0;
let active = false;

const recentChars: string[] = ["#", "@", "*", "+", "-", "o", "x"];
let recentScrollY = 0;

function addRecentChar(ch: string): void {
  if (ch === " " || ch === "") return;
  if (/^[a-zA-Z]$/.test(ch)) return;
  const index = recentChars.indexOf(ch);
  if (index !== -1) {
    recentChars.splice(index, 1);
  }
  recentChars.unshift(ch);
  recentScrollY = 0;
  if (recentChars.length > 100) {
    recentChars.pop();
  }
  saveState();
}

function buildLauncherScreen(): string[][] {
  const screen: string[][] = [];
  for (let r = 1; r <= rows; r++) {
    const row: string[] = [];
    for (let c = 1; c <= cols; c++) {
      row.push(`${COL_BG} `);
    }
    screen.push(row);
  }

  const titleText = "★ TERMINAL PAINT ★";
  const titleRow = Math.floor(rows * 0.2);
  const startCol = Math.floor((cols - titleText.length) / 2);
  for (let i = 0; i < titleText.length; i++) {
    if (startCol + i >= 0 && startCol + i < cols && titleRow >= 0 && titleRow < rows) {
      screen[titleRow][startCol + i] = `${fg256(201)}${bg256(232)}\x1b[1m${titleText[i]}`;
    }
  }

  const options = ["+ Create New Drawing", ...recentArts];
  const listStartRow = titleRow + 4;
  
  for (let idx = 0; idx < options.length; idx++) {
    const r = listStartRow + idx * 2;
    if (r >= rows - 3) break;
    const optText = options[idx];
    const isSelected = (idx === launcherSelection);
    const isConfirming = (deleteConfirmIdx === idx);
    const displayName = optText.length > cols - 16 ? path.basename(optText) : optText;
    
    let lineText = isSelected ? `>  ${displayName}  <` : `   ${displayName}   `;
    if (isConfirming) {
      lineText = `>  DELETE: ${displayName}? (d / Backspace again to delete)  <`;
    }
    
    let style = isSelected ? `${fg256(39)}${bg256(236)}\x1b[1m` : `${fg256(244)}${bg256(232)}`;
    if (isConfirming) {
      style = `${fg256(196)}${bg256(236)}\x1b[1m`;
    }
    
    const sCol = Math.floor((cols - lineText.length) / 2);
    for (let i = 0; i < lineText.length; i++) {
      if (sCol + i >= 0 && sCol + i < cols && r >= 0 && r < rows) {
        screen[r][sCol + i] = `${style}${lineText[i]}`;
      }
    }
  }

  const helpText = deleteConfirmIdx !== null
    ? "Press [d] or [Backspace] again to confirm deletion | ESC: Cancel"
    : "Up/Down / Scroll: Navigate | Enter / Click / Double-Click: Select | [dd]: Delete | [Q] Quit";
  
  const helpRow = rows - 2;
  const hCol = Math.floor((cols - helpText.length) / 2);
  const helpStyle = deleteConfirmIdx !== null ? `${fg256(208)}${bg256(232)}\x1b[1m` : `${fg256(240)}${bg256(232)}`;
  
  for (let i = 0; i < helpText.length; i++) {
    if (hCol + i >= 0 && hCol + i < cols && helpRow >= 0 && helpRow < rows) {
      screen[helpRow][hCol + i] = `${helpStyle}${helpText[i]}`;
    }
  }

  return screen;
}

let textCursorState = true;
let blinkTimer: any = null;

let statusHeight = 1;
let statusIndexMap = new Map<string, number>();
let statusText = "";

function getGridCell(x: number, y: number): string {
  const cx = x - 5;
  const cy = y - (statusHeight + 1);
  if (gridStyle === "dot") {
    if (cx % 2 === 0 && cy % 2 === 0) {
      return `${getGridColor()}·`;
    }
    return `${COL_BG} `;
  }
  if (gridStyle === "line") {
    if (cx % 2 === 0 && cy % 2 === 0) return `${getGridColor()}┼`;
    if (cx % 2 === 0) return `${getGridColor()}│`;
    if (cy % 2 === 0) return `${getGridColor()}─`;
    return `${COL_BG} `;
  }
  return `${COL_BG} `;
}

function buildStatusLayout(status: string, limit: number): { screenRows: string[][], indexMap: Map<string, number> } {
  const screenRows: string[][] = [];
  const indexMap = new Map<string, number>();
  
  const cells: { char: string, style: string, origIdx: number }[] = [];
  let currentStyle = COL_STATUS;
  let i = 0;
  
  while (i < status.length) {
    if (status[i] === "\x1b") {
      let j = i + 1;
      while (j < status.length && status[j] !== "m") {
        j++;
      }
      if (j < status.length) {
        currentStyle += status.slice(i, j + 1);
        i = j + 1;
        continue;
      }
    }
    cells.push({ char: status[i], style: currentStyle, origIdx: i });
    i++;
  }
  
  let currentLine: { char: string, style: string, origIdx: number }[] = [];
  let lineIdx = 1;
  let wordBuffer: { char: string, style: string, origIdx: number }[] = [];
  
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.char === " ") {
      if (currentLine.length + (currentLine.length ? 1 : 0) + wordBuffer.length <= limit) {
        if (currentLine.length) {
          currentLine.push({ char: " ", style: cell.style, origIdx: cell.origIdx });
        }
        currentLine.push(...wordBuffer);
      } else {
        if (currentLine.length) {
          while (currentLine.length < limit) {
            currentLine.push({ char: " ", style: COL_STATUS, origIdx: -1 });
          }
          screenRows.push(currentLine.map(item => `${item.style}${item.char}`));
          for (let x = 1; x <= limit; x++) {
            const orig = currentLine[x - 1].origIdx;
            if (orig !== -1) indexMap.set(`${x},${lineIdx}`, orig);
          }
          lineIdx++;
        }
        currentLine = [...wordBuffer];
      }
      wordBuffer = [];
    } else {
      wordBuffer.push(cell);
    }
  }
  
  if (wordBuffer.length) {
    if (currentLine.length + (currentLine.length ? 1 : 0) + wordBuffer.length <= limit) {
      if (currentLine.length) {
        currentLine.push({ char: " ", style: wordBuffer[0].style, origIdx: wordBuffer[0].origIdx - 1 });
      }
      currentLine.push(...wordBuffer);
    } else {
      if (currentLine.length) {
        while (currentLine.length < limit) currentLine.push({ char: " ", style: COL_STATUS, origIdx: -1 });
        screenRows.push(currentLine.map(item => `${item.style}${item.char}`));
        for (let x = 1; x <= limit; x++) {
          const orig = currentLine[x - 1].origIdx;
          if (orig !== -1) indexMap.set(`${x},${lineIdx}`, orig);
        }
        lineIdx++;
      }
      currentLine = [...wordBuffer];
    }
  }
  
  if (currentLine.length) {
    while (currentLine.length < limit) currentLine.push({ char: " ", style: COL_STATUS, origIdx: -1 });
    screenRows.push(currentLine.map(item => `${item.style}${item.char}`));
    for (let x = 1; x <= limit; x++) {
      const orig = currentLine[x - 1].origIdx;
      if (orig !== -1) indexMap.set(`${x},${lineIdx}`, orig);
    }
  }
  
  return { screenRows, indexMap };
}

function startCursorBlink(): void {
  if (blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
  if (tool === "text") {
    textCursorState = true;
    blinkTimer = setInterval(() => {
      textCursorState = !textCursorState;
      draw();
    }, 530);
  } else {
    textCursorState = true;
  }
}

// Undo/redo
const undoStack: Map<string, Cell>[] = [];
const redoStack: Map<string, Cell>[] = [];

// Bracketed paste state
let pasting = false;
let pasteBuffer = "";

// Diff render cache
let prevScreen: string[][] | null = null;

// ANSI helpers
const ESC = "\x1b";
const CLEAR = `${ESC}[2J`;
const HOME = `${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const RESET = `${ESC}[0m`;

const ENABLE_MOUSE = `${ESC}[?1000h${ESC}[?1003h${ESC}[?1006h`;
const DISABLE_MOUSE = `${ESC}[?1006l${ESC}[?1003l${ESC}[?1000l`;
const ENABLE_BRACKETED_PASTE = `${ESC}[?2004h`;
const DISABLE_BRACKETED_PASTE = `${ESC}[?2004l`;
const ENABLE_ALL = ENABLE_MOUSE + ENABLE_BRACKETED_PASTE;
const DISABLE_ALL = DISABLE_MOUSE + DISABLE_BRACKETED_PASTE;

function fg256(n: number): string {
  return `${ESC}[38;5;${n}m`;
}
function bg256(n: number): string {
  return `${ESC}[48;5;${n}m`;
}

const COL_BG = bg256(232);
const COL_DOT = `${fg256(236)}${bg256(232)}`; // very dim dot on dark bg
const COL_CURSOR = `${fg256(255)}${bg256(238)}`;
const COL_STATUS = `${fg256(250)}${bg256(232)}`;

// 8-color palette (1-8)
const PALETTE: Record<number, number> = {
  1: 255,
  2: 196,
  3: 46,
  4: 39,
  5: 201,
  6: 220,
  7: 33,
  8: 208,
};

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function snapshot(): Map<string, Cell> {
  return new Map(canvas);
}

function pushUndo(): void {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

function undo(): void {
  if (undoStack.length === 0) return;
  redoStack.push(snapshot());
  canvas.clear();
  for (const [k, v] of undoStack.pop()!) canvas.set(k, v);
}

function redo(): void {
  if (redoStack.length === 0) return;
  undoStack.push(snapshot());
  canvas.clear();
  for (const [k, v] of redoStack.pop()!) canvas.set(k, v);
}

function paint(x: number, y: number, char: string = brush, c: number = color): void {
  if (x >= 5 && x <= cols && y >= statusHeight + 1 && y <= rows) {
    const opacity = getCurrentOpacity();
    const adjustedColor = adjustColorOpacity(c, opacity);
    canvas.set(cellKey(x + panX, y + panY), { ch: char, color: adjustedColor });
    if (tool === "brush" || tool === "text") {
      addRecentChar(char);
    }
  }
}

function deleteCell(x: number, y: number): void {
  if (x >= 5 && x <= cols && y >= statusHeight + 1 && y <= rows) {
    canvas.delete(cellKey(x + panX, y + panY));
  }
}

function clearCanvas(): void {
  pushUndo();
  canvas.clear();
}

function drawLineCells(x0: number, y0: number, x1: number, y1: number): void {
  x0 = Math.max(5, Math.min(cols, x0));
  y0 = Math.max(statusHeight + 1, Math.min(rows, y0));
  x1 = Math.max(5, Math.min(cols, x1));
  y1 = Math.max(statusHeight + 1, Math.min(rows, y1));
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    paint(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function eraseLineCells(x0: number, y0: number, x1: number, y1: number): void {
  x0 = Math.max(5, Math.min(cols, x0));
  y0 = Math.max(statusHeight + 1, Math.min(rows, y0));
  x1 = Math.max(5, Math.min(cols, x1));
  y1 = Math.max(statusHeight + 1, Math.min(rows, y1));
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    deleteCell(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawRectBorder(x0: number, y0: number, x1: number, y1: number): void {
  const left = Math.max(5, Math.min(x0, x1));
  const right = Math.min(cols, Math.max(x0, x1));
  const top = Math.max(statusHeight + 1, Math.min(y0, y1));
  const bottom = Math.min(rows, Math.max(y0, y1));
  for (let x = left; x <= right; x++) {
    paint(x, top, "─");
    paint(x, bottom, "─");
  }
  for (let y = top; y <= bottom; y++) {
    paint(left, y, "│");
    paint(right, y, "│");
  }
  paint(left, top, "┌");
  paint(right, top, "┐");
  paint(left, bottom, "└");
  paint(right, bottom, "┘");
}

// Single source of truth for cell rendering. Hover always wins.
function cellAt(x: number, y: number): string {
  // Left bar separator & scrollbar
  if (x === 4) {
    const height = rows - statusHeight;
    const total = recentChars.length;
    if (total > height) {
      const thumbHeight = Math.max(1, Math.floor((height / total) * height));
      const maxScroll = total - height;
      const pct = maxScroll > 0 ? recentScrollY / maxScroll : 0;
      const startOffset = Math.floor(pct * (height - thumbHeight));
      const startRow = statusHeight + 1 + startOffset;
      const endRow = startRow + thumbHeight;
      if (y >= startRow && y < endRow) {
        return `${fg256(246)}${bg256(232)}┃`; // Scrollbar thumb
      } else {
        return `${fg256(236)}${bg256(232)}│`; // Track
      }
    }
    return `${fg256(238)}${bg256(232)}│`;
  }
  // Left bar content
  if (x < 4) {
    const idx = y - (statusHeight + 1) + recentScrollY;
    if (idx >= 0 && idx < recentChars.length) {
      const ch = recentChars[idx];
      const isActive = ch === brush && tool !== "eraser";
      if (x === 1) return isActive ? `${fg256(240)}${bg256(232)}[` : `${COL_BG} `;
      if (x === 2) return isActive ? `${fg256(255)}${bg256(232)}${ch}` : `${fg256(244)}${bg256(232)}${ch}`;
      if (x === 3) return isActive ? `${fg256(240)}${bg256(232)}]` : `${COL_BG} `;
    }
    return `${COL_BG} `;
  }

  // Selection box drawing preview
  if (active && tool === "select") {
    const pLeft = Math.max(5, Math.min(startX, hoverX) - 1);
    const pRight = Math.min(cols, Math.max(startX, hoverX) + 1);
    const pTop = Math.max(statusHeight + 1, Math.min(startY, hoverY) - 1);
    const pBottom = Math.min(rows, Math.max(startY, hoverY) + 1);
    if (x >= pLeft && x <= pRight && y >= pTop && y <= pBottom) {
      if (x === pLeft || x === pRight || y === pTop || y === pBottom) {
        const borderChar = getSelectionBorderChar(x, y, pLeft, pRight, pTop, pBottom);
        return `${fg256(39)}${bg256(232)}${borderChar}`;
      }
    }
  }

  // Box preview
  if (active && tool === "box") {
    const borderChar = boxPreviewCells.get(cellKey(x, y));
    if (borderChar !== undefined) {
      const opacity = getCurrentOpacity();
      const adjustedColor = adjustColorOpacity(color, opacity);
      return `${fg256(adjustedColor)}${bg256(232)}${borderChar}`;
    }
  }

  // Line preview
  if (active && tool === "line" && linePreviewCells.has(cellKey(x, y))) {
    const opacity = getCurrentOpacity();
    const adjustedColor = adjustColorOpacity(color, opacity);
    return `${fg256(adjustedColor)}${bg256(232)}${brush}`;
  }

  // Active selection rendering
  if (selectionActive && selectionRect) {
    const dx = moveOffset.dx;
    const dy = moveOffset.dy;
    const selLeft = selectionRect.x0 + dx;
    const selRight = selectionRect.x1 + dx;
    const selTop = selectionRect.y0 + dy;
    const selBottom = selectionRect.y1 + dy;

    const ax = x + panX;
    const ay = y + panY;
    if (ax >= selLeft && ax <= selRight && ay >= selTop && ay <= selBottom) {
      const cell = selectionCells.get(cellKey(ax - dx, ay - dy));
      const isBorder = (ax === selLeft || ax === selRight || ay === selTop || ay === selBottom);
      
      if (isBorder) {
        const borderChar = getSelectionBorderChar(ax, ay, selLeft, selRight, selTop, selBottom);
        if (cell !== undefined) {
          return `${fg256(cell.color)}${bg256(24)}${cell.ch}`;
        }
        return `${fg256(39)}${bg256(232)}${borderChar}`;
      }
      
      if (cell !== undefined) {
        return `${fg256(cell.color)}${bg256(232)}${cell.ch}`;
      }
      const paintedUnder = canvas.get(cellKey(ax, ay));
      if (paintedUnder !== undefined) {
        const col = selectionActive ? adjustColorOpacity(paintedUnder.color, 2) : paintedUnder.color;
        return `${fg256(col)}${bg256(232)}${paintedUnder.ch}`;
      }
      return getGridCell(x, y);
    }
  }

  // Main canvas
  const ax = x + panX;
  const ay = y + panY;
  if (x === hoverX && y === hoverY) {
    const opacity = getCurrentOpacity();
    const adjustedColor = adjustColorOpacity(color, opacity);
    if (tool === "text") {
      if (textCursorState) {
        const painted = canvas.get(cellKey(ax, ay));
        const char = painted !== undefined ? painted.ch : "_";
        return `${fg256(adjustedColor)}${bg256(238)}${char}`;
      } else {
        const painted = canvas.get(cellKey(ax, ay));
        if (painted !== undefined) {
          const col = selectionActive ? adjustColorOpacity(painted.color, 2) : painted.color;
          return `${fg256(col)}${bg256(232)}${painted.ch}`;
        }
        return getGridCell(x, y);
      }
    }
    return `${fg256(adjustedColor)}${bg256(238)}${tool === "eraser" ? " " : (tool === "select" ? "▫" : brush)}`;
  }
  const painted = canvas.get(cellKey(ax, ay));
  if (painted !== undefined) {
    const col = selectionActive ? adjustColorOpacity(painted.color, 2) : painted.color;
    return `${fg256(col)}${bg256(232)}${painted.ch}`;
  }
  return getGridCell(x, y);
}

function buildScreen(): string[][] {
  if (savingMode) {
    statusText = `Save Drawing as: [ ${saveFilename} ] (Press ENTER to save, ESC to cancel)`;
    const layout = buildStatusLayout(statusText, cols);
    statusHeight = layout.screenRows.length;
    statusIndexMap = layout.indexMap;
    
    const screen: string[][] = [];
    screen.push(...layout.screenRows);
    for (let y = statusHeight + 1; y <= rows; y++) {
      const row: string[] = [];
      for (let x = 1; x <= cols; x++) {
        row.push(cellAt(x, y));
      }
      screen.push(row);
    }
    return screen;
  }

  const currentOpacity = getCurrentOpacity();
  const opacityBar = "█".repeat(currentOpacity) + "░".repeat(5 - currentOpacity);
  
  let opacityLabel = "Opacity";
  if (opacityTarget === "brush") opacityLabel = "Brush Opacity";
  else if (opacityTarget === "box") opacityLabel = "Box Opacity";
  else if (opacityTarget === "line") opacityLabel = "Line Opacity";
  else if (opacityTarget === "text") opacityLabel = "Text Opacity";
  else if (opacityTarget === "grid") opacityLabel = "Grid Opacity";

  let colorBarText = "Colors:[";
  for (let k = 1; k <= 8; k++) {
    const isSelected = (color === PALETTE[k]);
    const colCode = PALETTE[k];
    if (isSelected) {
      colorBarText += `${fg256(232)}${bg256(colCode)} ${k} ${COL_STATUS}`;
    } else {
      colorBarText += `${fg256(colCode)}${bg256(232)} ${k} ${COL_STATUS}`;
    }
  }
  colorBarText += "]";

  const styleTool = (name: string, t: Tool) => {
    const isSel = (tool === t);
    return isSel
      ? `\x1b[1;4;38;5;39m${name}\x1b[22;24;38;5;250;48;5;232m`
      : name;
  };

  const tBrush = styleTool("[B]rush", "brush");
  const tEraser = styleTool("[E]raser", "eraser");
  const tSelect = styleTool("[S]elect", "select");
  const tBox = styleTool("[X]box", "box");
  const tLine = styleTool("[L]line", "line");
  const tText = styleTool("[T]ext", "text");

  statusText =
    `${tBrush} ${tEraser} ${tSelect} ${tBox} ${tLine} ${tText} [G]rid ${opacityLabel}:[${opacityBar}] | ${colorBarText} | Z undo Y redo | C clear Q quit | tool=${tool} brush="${brush}" grid=${gridStyle}`;
  
  const layout = buildStatusLayout(statusText, cols);
  statusHeight = layout.screenRows.length;
  statusIndexMap = layout.indexMap;
  
  const screen: string[][] = [];
  screen.push(...layout.screenRows);

  for (let y = statusHeight + 1; y <= rows; y++) {
    const row: string[] = [];
    for (let x = 1; x <= cols; x++) {
      row.push(cellAt(x, y));
    }
    screen.push(row);
  }
  return screen;
}

function draw(): void {
  updatePreviewCells();
  const screen = appState === "launcher" ? buildLauncherScreen() : buildScreen();
  let buf: string;

  if (
    !prevScreen ||
    prevScreen.length !== rows ||
    (prevScreen[0]?.length ?? 0) !== cols
  ) {
    buf = CLEAR + HOME + HIDE_CURSOR;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        buf += screen[y][x];
      }
      if (y < rows - 1) buf += "\r\n";
    }
  } else {
    buf = HIDE_CURSOR;
    let cx = -1;
    let cy = -1;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (screen[y][x] !== prevScreen[y][x]) {
          if (cx !== x + 1 || cy !== y + 1) {
            buf += `${ESC}[${y + 1};${x + 1}H`;
            cx = x + 1;
            cy = y + 1;
          }
          buf += screen[y][x];
          cx++;
        }
      }
    }
  }
  prevScreen = screen;
  stdout.write(buf);
}

function drawCursorMove(prevX: number, prevY: number): void {
  if (
    !prevScreen ||
    prevX < 5 ||
    prevX > cols ||
    prevY < statusHeight + 1 ||
    prevY > rows
  ) {
    draw();
    return;
  }
  const oldCell = cellAt(prevX, prevY);
  const newCell = cellAt(hoverX, hoverY);
  const buf =
    HIDE_CURSOR +
    `${ESC}[${prevY};${prevX}H${oldCell}` +
    `${ESC}[${hoverY};${hoverX}H${newCell}`;
  prevScreen[prevY - 1][prevX - 1] = oldCell;
  prevScreen[hoverY - 1][hoverX - 1] = newCell;
  stdout.write(buf);
}

function pasteText(text: string): void {
  pushUndo();
  const lines = text.split(/\r\n|\r|\n/);
  for (let r = 0; r < lines.length; r++) {
    const y = hoverY + r;
    if (y > rows) break;
    const chars = [...lines[r].replace(/\t/g, "    ")];
    for (let i = 0; i < chars.length; i++) {
      const x = hoverX + i;
      if (x > cols) break;
      const ch = chars[i];
      if (ch >= " " && ch !== "\x7f") {
        paint(x, y, ch);
        addRecentChar(ch);
      }
    }
  }
  const textChars = [...text];
  if (textChars.length === 1 && textChars[0] !== " " && textChars[0] !== "\n" && textChars[0] !== "\r") {
    brush = textChars[0];
  }
  draw();
}

function exit(): void {
  if (blinkTimer) clearInterval(blinkTimer);
  stdout.write(SHOW_CURSOR + DISABLE_ALL + CLEAR + HOME + RESET);
  stdin.setRawMode(false);
  stdin.pause();
  process.exit(0);
}

function handleMouse(seq: string): void {
  const m = seq.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (!m) return;
  const btn = Number.parseInt(m[1], 10);
  const x = Number.parseInt(m[2], 10);
  const y = Number.parseInt(m[3], 10);
  const released = m[4] === "m";

  if (appState === "launcher") {
    deleteConfirmIdx = null;
    if (btn === 64 || btn === 65) {
      const options = ["+ Create New Drawing", ...recentArts];
      if (btn === 64) {
        launcherSelection = launcherSelection - 1;
        if (launcherSelection < 0) launcherSelection = options.length - 1;
      } else {
        launcherSelection = (launcherSelection + 1) % options.length;
      }
      draw();
    } else if (btn === 0 && !released) {
      const titleRow = Math.floor(rows * 0.2);
      const listStartRow = titleRow + 4;
      const options = ["+ Create New Drawing", ...recentArts];
      
      for (let idx = 0; idx < options.length; idx++) {
        const r = listStartRow + idx * 2;
        if (y === r + 1) {
          launcherSelection = idx;
          draw();
          
          const now = Date.now();
          const isDoubleClick = (now - lastClickTime < 400) && (x === lastClickX) && (y === lastClickY);
          lastClickTime = now;
          lastClickX = x;
          lastClickY = y;
          
          if (isDoubleClick) {
            selectLauncherOption();
          }
          break;
        }
      }
    }
    return;
  }

  // Right click panning
  if (btn === 2 && !released) {
    panning = true;
    panStart = { x, y };
    originalPan = { x: panX, y: panY };
    return;
  }
  if (btn === 34) { // Right click drag
    if (panning) {
      const dx = x - panStart.x;
      const dy = y - panStart.y;
      panX = originalPan.x - dx;
      panY = originalPan.y - dy;
      draw();
    }
    return;
  }
  if (btn === 2 && released) {
    panning = false;
    prevScreen = null;
    draw();
    return;
  }

  // Handle scroll events
  if (btn === 64 || btn === 65) {
    if (x < 4) {
      if (btn === 64) {
        recentScrollY = Math.max(0, recentScrollY - 1);
      } else {
        const maxScroll = Math.max(0, recentChars.length - (rows - statusHeight));
        recentScrollY = Math.min(maxScroll, recentScrollY + 1);
      }
      draw();
      return;
    }
    if (y <= statusHeight) {
      const origIdx = statusIndexMap.get(`${x},${y}`);
      if (origIdx !== undefined) {
        const opacityStart = statusText.indexOf("Opacity:[");
        const colorStart = statusText.indexOf("Colors:[");
        const colorEnd = statusText.indexOf("] | Z undo");

        if (opacityStart !== -1 && origIdx >= opacityStart && origIdx < opacityStart + 15) {
          const current = getCurrentOpacity();
          if (btn === 64) {
            setCurrentOpacity(Math.min(5, current + 1));
          } else {
            setCurrentOpacity(Math.max(1, current - 1));
          }
          draw();
          return;
        }
        if (colorStart !== -1 && colorEnd !== -1 && origIdx >= colorStart && origIdx <= colorEnd) {
          let currentKey = 1;
          for (let k = 1; k <= 8; k++) {
            if (color === PALETTE[k]) currentKey = k;
          }
          if (btn === 64) {
            currentKey = (currentKey % 8) + 1;
          } else {
            currentKey = currentKey - 1;
            if (currentKey < 1) currentKey = 8;
          }
          color = PALETTE[currentKey];
          updateSelectionColor(color);
          draw();
          return;
        }
      }
    }
    return;
  }

  if (x < 1 || x > cols || y < 1 || y > rows) return;

  // Handle clicks on status bar (y <= statusHeight)
  if (y <= statusHeight) {
    if (btn === 0 && !released) {
      const origIdx = statusIndexMap.get(`${x},${y}`);
      if (origIdx !== undefined) {
        const brushStart = statusText.indexOf("[B]rush");
        const eraserStart = statusText.indexOf("[E]raser");
        const selectStart = statusText.indexOf("[S]elect");
        const boxStart = statusText.indexOf("[X]box");
        const lineStart = statusText.indexOf("[L]line");
        const textStart = statusText.indexOf("[T]ext");
        const gridStart = statusText.indexOf("[G]rid");
        const opacityStart = statusText.indexOf("Opacity:[");
        const colorStart = statusText.indexOf("Colors:[");

        if (brushStart !== -1 && origIdx >= brushStart && origIdx < brushStart + 7) {
          commitSelection();
          tool = "brush";
          opacityTarget = "brush";
        } else if (eraserStart !== -1 && origIdx >= eraserStart && origIdx < eraserStart + 8) {
          commitSelection();
          tool = "eraser";
        } else if (selectStart !== -1 && origIdx >= selectStart && origIdx < selectStart + 8) {
          commitSelection();
          tool = "select";
          opacityTarget = "select";
        } else if (boxStart !== -1 && origIdx >= boxStart && origIdx < boxStart + 6) {
          commitSelection();
          tool = "box";
          opacityTarget = "box";
        } else if (lineStart !== -1 && origIdx >= lineStart && origIdx < lineStart + 7) {
          commitSelection();
          tool = "line";
          opacityTarget = "line";
        } else if (textStart !== -1 && origIdx >= textStart && origIdx < textStart + 6) {
          commitSelection();
          tool = "text";
          opacityTarget = "text";
        } else if (gridStart !== -1 && origIdx >= gridStart && origIdx < gridStart + 6) {
          opacityTarget = "grid";
        } else if (opacityStart !== -1 && origIdx >= opacityStart + 9 && origIdx < opacityStart + 14) {
          setCurrentOpacity(origIdx - (opacityStart + 9) + 1);
        }
        startCursorBlink();
        draw();
      }
    }
    return;
  }

  // Handle clicks on left bar (x < 4)
  if (x < 4 && y >= statusHeight + 1) {
    if (btn === 0 && !released) {
      const idx = y - (statusHeight + 1) + recentScrollY;
      if (idx >= 0 && idx < recentChars.length) {
        commitSelection();
        brush = recentChars[idx];
        tool = "brush";
        opacityTarget = "brush";
        startCursorBlink();
        draw();
      }
    }
    return;
  }

  // Main canvas interaction
  const cx = Math.min(Math.max(5, x), cols);
  const cy = Math.max(statusHeight + 1, y);

  if (released) {
    if (tool === "select") {
      if (movingSelection) {
        movingSelection = false;
        moveOffset.dx = cx - moveStart!.x;
        moveOffset.dy = cy - moveStart!.y;
        
        if (selectionRect) {
          selectionRect.x0 += moveOffset.dx;
          selectionRect.x1 += moveOffset.dx;
          selectionRect.y0 += moveOffset.dy;
          selectionRect.y1 += moveOffset.dy;
        }
        const newSelectionCells = new Map<string, Cell>();
        for (const [k, v] of selectionCells) {
          const coords = k.split(",").map(Number);
          const nx = coords[0] + moveOffset.dx;
          const ny = coords[1] + moveOffset.dy;
          newSelectionCells.set(cellKey(nx, ny), v);
        }
        selectionCells = newSelectionCells;
        moveOffset = { dx: 0, dy: 0 };
      } else if (active) {
        active = false;
        const left = Math.min(startX, cx);
        const right = Math.max(startX, cx);
        const top = Math.min(startY, cy);
        const bottom = Math.max(startY, cy);
        
        const clickedCharExists = (right === left && bottom === top && canvas.has(cellKey(cx + panX, cy + panY)));
        const isDrag = (right > left || bottom > top);
        
        if (isDrag || clickedCharExists) {
          selectionActive = true;
          selectionRect = {
            x0: Math.max(5, left - 1) + panX,
            y0: Math.max(statusHeight + 1, top - 1) + panY,
            x1: Math.min(cols, right + 1) + panX,
            y1: Math.min(rows, bottom + 1) + panY
          };
          pushUndo();
          selectionCells.clear();
          for (let y = top; y <= bottom; y++) {
            for (let x = left; x <= right; x++) {
              const key = cellKey(x + panX, y + panY);
              const cell = canvas.get(key);
              if (cell) {
                selectionCells.set(key, cell);
                canvas.delete(key);
              }
            }
          }
        } else {
          selectionActive = false;
          selectionRect = null;
          selectionCells.clear();
        }
      }
    } else {
      if (active) {
        const isDrag = (startX !== cx || startY !== cy);
        if (isDrag) {
          if (tool === "box") {
            pushUndo();
            drawRectBorder(startX, startY, cx, cy);
          } else if (tool === "line") {
            pushUndo();
            drawLineCells(startX, startY, cx, cy);
          }
        }
      }
    }
    active = false;
    draw();
    return;
  }

  if (btn === 0) {
    hoverX = cx;
    hoverY = cy;
    lastClickCanvasX = cx + panX;
    lastClickCanvasY = cy + panY;
    if (tool === "select") {
      const inside = selectionActive && selectionRect && (cx + panX) >= selectionRect.x0 && (cx + panX) <= selectionRect.x1 && (cy + panY) >= selectionRect.y0 && (cy + panY) <= selectionRect.y1;
      if (inside) {
        movingSelection = true;
        moveStart = { x: cx, y: cy };
        moveOffset = { dx: 0, dy: 0 };
      } else {
        commitSelection();
        startX = cx;
        startY = cy;
        active = true;
      }
    } else {
      if (tool === "brush" || tool === "eraser") pushUndo();
      startX = cx;
      startY = cy;
      active = true;
      if (tool === "brush") paint(cx, cy);
      else if (tool === "eraser") deleteCell(cx, cy);
    }
    draw();
    return;
  }

  if (btn === 32) {
    hoverX = cx;
    hoverY = cy;
    if (tool === "select") {
      if (movingSelection) {
        moveOffset.dx = cx - moveStart!.x;
        moveOffset.dy = cy - moveStart!.y;
      } else if (active) {
        hoverX = cx;
        hoverY = cy;
      }
    } else {
      if (active) {
        if (tool === "brush") {
          drawLineCells(startX, startY, cx, cy);
          startX = cx;
          startY = cy;
        } else if (tool === "eraser") {
          eraseLineCells(startX, startY, cx, cy);
          startX = cx;
          startY = cy;
        }
      }
    }
    draw();
    return;
  }

  if (btn === 35 || btn === 3) {
    if (cx !== hoverX || cy !== hoverY) {
      const prevX = hoverX;
      const prevY = hoverY;
      hoverX = cx;
      hoverY = cy;
      if (tool === "text") {
        startCursorBlink();
      }
      drawCursorMove(prevX, prevY);
    }
  }
}

function copyToClipboard(text: string): void {
  try {
    spawnSync("clip", { input: text });
  } catch (err) {
    // Ignore
  }
}

function handleKey(code: number): void {
  if (savingMode) {
    if (code === 0x0d || code === 0x0a) {
      if (saveFilename.trim().length > 0) {
        executeSave(saveFilename.trim());
      }
      savingMode = false;
      draw();
      return;
    }
    if (code === 0x1b) {
      savingMode = false;
      draw();
      return;
    }
    if (code === 0x7f || code === 0x08) {
      saveFilename = saveFilename.slice(0, -1);
      draw();
      return;
    }
    if (code >= 0x20 && code <= 0x7e) {
      saveFilename += String.fromCharCode(code);
      draw();
      return;
    }
    return;
  }

  if (appState === "launcher") {
    if (code === 0x1b) {
      if (deleteConfirmIdx !== null) {
        deleteConfirmIdx = null;
        draw();
        return;
      }
    }
    if (code === 0x0d || code === 0x0a) {
      selectLauncherOption();
      return;
    }
    if (code === 0x7f || code === 0x08) {
      handleLauncherDelete();
      return;
    }
    if (code === 0x64 || code === 0x44) { // 'd' or 'D'
      handleLauncherDelete();
      return;
    }
    if (code === 0x71 || code === 0x51) {
      exit();
      return;
    }
    if (code === 0x6e || code === 0x4e) {
      canvas.clear();
      currentOpenFile = "";
      appState = "editor";
      prevScreen = null;
      draw();
      return;
    }
    // Any other key resets delete confirmation
    if (deleteConfirmIdx !== null) {
      deleteConfirmIdx = null;
      draw();
    }
    return;
  }

  if (code === 0x13) {
    commitSelection();
    savingMode = true;
    saveFilename = currentOpenFile ? path.basename(currentOpenFile) : "untitled.json";
    draw();
    return;
  }

  if (code === 0x03) {
    if (tool === "select" && selectionActive && selectionRect) {
      clipboardCells.clear();
      const w = selectionRect.x1 - selectionRect.x0 - 1;
      const h = selectionRect.y1 - selectionRect.y0 - 1;
      clipboardRect = { w, h };
      
      for (const [k, v] of selectionCells) {
        const coords = k.split(",").map(Number);
        const ox = coords[0] - (selectionRect.x0 + 1);
        const oy = coords[1] - (selectionRect.y0 + 1);
        clipboardCells.set(`${ox},${oy}`, v);
      }
      
      // Build plain text representation and copy to OS clipboard
      const textLines: string[] = [];
      const charLeft = selectionRect.x0 + 1;
      const charRight = selectionRect.x1 - 1;
      const charTop = selectionRect.y0 + 1;
      const charBottom = selectionRect.y1 - 1;
      
      for (let y = charTop; y <= charBottom; y++) {
        let line = "";
        for (let x = charLeft; x <= charRight; x++) {
          const cell = selectionCells.get(cellKey(x, y));
          line += cell !== undefined ? cell.ch : " ";
        }
        textLines.push(line);
      }
      
      const plainText = textLines.join("\r\n");
      copyToClipboard(plainText);
      
      draw();
      return;
    }
    return;
  }
  if (code === 0x04) {
    commitSelection();
    exit();
    return;
  }
  if (code === 0x16) { // Ctrl+V
    if (clipboardCells.size > 0 && clipboardRect) {
      commitSelection();
      tool = "select";
      
      const baseClickX = lastClickCanvasX !== -1 ? lastClickCanvasX : (hoverX + panX);
      const baseClickY = lastClickCanvasY !== -1 ? lastClickCanvasY : (hoverY + panY);
      const x0 = baseClickX - 1;
      const y0 = baseClickY - 1;
      const x1 = x0 + clipboardRect.w + 1;
      const y1 = y0 + clipboardRect.h + 1;
      
      selectionActive = true;
      selectionRect = { x0, y0, x1, y1 };
      selectionCells.clear();
      
      for (const [k, v] of clipboardCells) {
        const coords = k.split(",").map(Number);
        const nx = baseClickX + coords[0];
        const ny = baseClickY + coords[1];
        const sx = nx - panX;
        const sy = ny - panY;
        if (sx >= 5 && sx <= cols && sy >= statusHeight + 1 && sy <= rows) {
          selectionCells.set(cellKey(nx, ny), {
            ch: v.ch,
            color: v.color,
            baseColor: v.baseColor ?? v.color
          });
        }
      }
      
      movingSelection = false;
      moveOffset = { dx: 0, dy: 0 };
      draw();
    }
    return;
  }
  if (code === 0x1a) {
    commitSelection();
    undo();
    draw();
    return;
  }
  if (code === 0x19) {
    commitSelection();
    redo();
    draw();
    return;
  }
  if (tool === "text") {
    if (code === 0x0d || code === 0x0a) {
      hoverY = Math.min(hoverY + 1, rows);
      hoverX = startX;
      startCursorBlink();
      draw();
      return;
    }
    if (code === 0x7f || code === 0x08) {
      pushUndo();
      hoverX = Math.max(1, hoverX - 1);
      deleteCell(hoverX, hoverY);
      startCursorBlink();
      draw();
      return;
    }
    if (code >= 0x20 && code !== 0x7f) {
      pushUndo();
      paint(hoverX, hoverY, String.fromCharCode(code));
      hoverX = Math.min(hoverX + 1, cols);
      startCursorBlink();
      draw();
      return;
    }
    return;
  }
  if (code === 0x62) {
    commitSelection();
    tool = "brush";
    opacityTarget = "brush";
    startCursorBlink();
    draw();
    return;
  }
  if (code === 0x65) {
    commitSelection();
    tool = "eraser";
    startCursorBlink();
    draw();
    return;
  }
  if (code === 0x73) {
    commitSelection();
    tool = "select";
    opacityTarget = "select";
    startCursorBlink();
    draw();
    return;
  }
  if (code === 0x78) {
    commitSelection();
    tool = "box";
    opacityTarget = "box";
    startCursorBlink();
    draw();
    return;
  }
  if (code === 0x6c) {
    commitSelection();
    tool = "line";
    opacityTarget = "line";
    startCursorBlink();
    draw();
    return;
  }
  if (code === 0x74) {
    commitSelection();
    tool = "text";
    opacityTarget = "text";
    startCursorBlink();
    draw();
    return;
  }
  if (code === 0x67) {
    opacityTarget = "grid";
    if (gridStyle === "dot") gridStyle = "line";
    else if (gridStyle === "line") gridStyle = "none";
    else gridStyle = "dot";
    draw();
    return;
  }
  if (code === 0x6f) {
    const current = getCurrentOpacity();
    setCurrentOpacity((current % 5) + 1);
    draw();
    return;
  }
  if (code === 0x63) {
    if (tool === "select" && selectionActive) {
      selectionActive = false;
      selectionRect = null;
      selectionCells.clear();
      draw();
      return;
    }
    clearCanvas();
    draw();
    return;
  }
  if (code === 0x71) {
    exit();
    return;
  }
  if (code === 0x7a) {
    undo();
    draw();
    return;
  }
  if (code === 0x79) {
    redo();
    draw();
    return;
  }
  if (code >= 0x31 && code <= 0x38) {
    color = PALETTE[code - 0x30];
    updateSelectionColor(color);
    draw();
    return;
  }
  if (code >= 0x20 && code !== 0x7f) {
    brush = String.fromCharCode(code);
    addRecentChar(brush);
    draw();
  }
}

function processData(data: string): void {
  if (pasting) {
    pasteBuffer += data;
    const end = pasteBuffer.indexOf("\x1b[201~");
    if (end === -1) return;
    pasteText(pasteBuffer.slice(0, end));
    const rest = pasteBuffer.slice(end + 6);
    pasting = false;
    pasteBuffer = "";
    if (rest.length > 0) processData(rest);
    return;
  }

  let i = 0;
  while (i < data.length) {
    const ch = data[i];

    if (ch === ESC && data.slice(i, i + 6) === "\x1b[200~") {
      const end = data.indexOf("\x1b[201~", i + 6);
      if (end !== -1) {
        pasteText(data.slice(i + 6, end));
        i = end + 6;
        continue;
      }
      pasting = true;
      pasteBuffer = data.slice(i + 6);
      return;
    }

    if (ch === ESC && data.slice(i, i + 3) === "\x1b[<") {
      const endM = data.indexOf("M", i);
      const endm = data.indexOf("m", i);
      let end = -1;
      if (endM === -1 && endm !== -1) end = endm + 1;
      else if (endm === -1 && endM !== -1) end = endM + 1;
      else if (endM !== -1 && endm !== -1) end = Math.min(endM, endm) + 1;
      if (end > i) {
        handleMouse(data.slice(i, end));
        i = end;
        continue;
      }
    }

    if (ch === ESC) {
      if (data.length === 1 || i === data.length - 1) {
        if (savingMode) {
          savingMode = false;
          draw();
          i++;
          continue;
        }
        if (tool === "text" || tool === "select") {
          commitSelection();
          tool = "brush";
          startCursorBlink();
          draw();
        }
        i++;
        continue;
      }
      let j = i + 1;
      while (j < data.length && j < i + 10) {
        const c2 = data.charCodeAt(j);
        if (c2 >= 0x40 && c2 <= 0x7e) {
          j++;
          break;
        }
        j++;
      }
      const seq = data.slice(i, j);
      if (appState === "launcher") {
        if (seq === "\x1b[A" || seq === "\x1b[B") {
          deleteConfirmIdx = null;
        }
        if (seq === "\x1b[A") {
          const options = ["+ Create New Drawing", ...recentArts];
          launcherSelection = launcherSelection - 1;
          if (launcherSelection < 0) launcherSelection = options.length - 1;
          draw();
          i = j;
          continue;
        } else if (seq === "\x1b[B") {
          const options = ["+ Create New Drawing", ...recentArts];
          launcherSelection = (launcherSelection + 1) % options.length;
          draw();
          i = j;
          continue;
        } else if (seq === "\x1b[3~") { // Delete key
          handleLauncherDelete();
          i = j;
          continue;
        }
      }
      i = j;
      continue;
    }

    handleKey(data.charCodeAt(i));
    i++;
  }
}

function updateSize(): void {
  cols = stdout.columns ?? cols;
  rows = stdout.rows ?? rows;
  hoverX = Math.min(Math.max(5, hoverX), cols);
  hoverY = Math.min(Math.max(statusHeight + 1, hoverY), rows);
  draw();
}

stdout.on("resize", updateSize);

loadState();

stdin.setRawMode(true);
stdout.write(ENABLE_ALL + HIDE_CURSOR);
startCursorBlink();
draw();

stdin.on("data", (chunk: Buffer) => {
  processData(chunk.toString("utf8"));
});

process.on("SIGINT", exit);
process.on("SIGTERM", exit);
process.on("SIGWINCH", updateSize);
