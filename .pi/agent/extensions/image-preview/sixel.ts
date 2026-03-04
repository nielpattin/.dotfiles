/**
 * Sixel helpers for image-preview extension.
 *
 * Isolated here to keep index.ts focused on TUI patching + input transforms.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const POWER_SHELL_TIMEOUT_MS = 120_000;
const POWER_SHELL_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

export type SixelAvailability = {
  checked: boolean;
  available: boolean;
  version?: string;
  reason?: string;
};

type ImageLike = {
  data: string;
  mimeType: string;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Unknown error";
}

function runPowerShellCommand(
  script: string,
  args: string[] = [],
): { ok: boolean; stdout: string; stderr: string; reason?: string } {
  if (process.platform !== "win32") {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      reason: "PowerShell-based Sixel rendering is only available on Windows.",
    };
  }

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
      ...args,
    ],
    {
      encoding: "utf8",
      timeout: POWER_SHELL_TIMEOUT_MS,
      maxBuffer: POWER_SHELL_MAX_BUFFER_BYTES,
      windowsHide: true,
    },
  );

  if (result.error) {
    return {
      ok: false,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      reason: getErrorMessage(result.error),
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      reason: `PowerShell exited with code ${result.status}`,
    };
  }

  return {
    ok: true,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const sixelAvailabilityState: SixelAvailability = {
  checked: false,
  available: false,
};

export function ensureSixelModuleAvailable(forceRefresh = false): SixelAvailability {
  if (sixelAvailabilityState.checked && !forceRefresh) {
    return sixelAvailabilityState;
  }

  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$module = Get-Module -ListAvailable -Name Sixel | Sort-Object Version -Descending | Select-Object -First 1
if ($null -eq $module) {
  try {
    if (Get-Command Install-Module -ErrorAction SilentlyContinue) {
      Install-Module -Name Sixel -Scope CurrentUser -Force -AllowClobber -Repository PSGallery -ErrorAction Stop | Out-Null
    } elseif (Get-Command Install-PSResource -ErrorAction SilentlyContinue) {
      Install-PSResource -Name Sixel -Scope CurrentUser -TrustRepository -Reinstall -Force -ErrorAction Stop | Out-Null
    }
  } catch {
  }

  $module = Get-Module -ListAvailable -Name Sixel | Sort-Object Version -Descending | Select-Object -First 1
}

if ($null -eq $module) {
  Write-Error 'Sixel PowerShell module is unavailable.'
}

Write-Output ('Sixel/' + $module.Version.ToString())
`;

  const result = runPowerShellCommand(script);
  sixelAvailabilityState.checked = true;

  if (!result.ok) {
    const stderr = normalizeText(result.stderr);
    const stdout = normalizeText(result.stdout);
    sixelAvailabilityState.available = false;
    sixelAvailabilityState.version = undefined;
    sixelAvailabilityState.reason =
      stderr || stdout || result.reason || "Failed to detect/install the Sixel PowerShell module.";
    return sixelAvailabilityState;
  }

  const marker = normalizeText(result.stdout)
    .split(/\r?\n/)
    .find((line) => line.startsWith("Sixel/"));
  sixelAvailabilityState.available = true;
  sixelAvailabilityState.version = marker ? marker.slice("Sixel/".length) : undefined;
  sixelAvailabilityState.reason = undefined;
  return sixelAvailabilityState;
}

function extensionForImageMimeType(mimeType: string): string {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
  switch (normalized) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    default:
      return "png";
  }
}

function normalizeSixelSequence(value: string): string {
  return value.replace(/\r?\n/g, "").replace(/\s+$/g, "");
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

export function convertImageToSixelSequence(
  image: ImageLike,
): { sequence?: string; error?: string } {
  const tempBaseDir = mkdtempSync(join(tmpdir(), "pi-image-tools-image-"));
  const imagePath = join(tempBaseDir, `preview.${extensionForImageMimeType(image.mimeType)}`);

  try {
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length === 0) {
      return { error: "Image conversion failed: clipboard payload was empty." };
    }

    writeFileSync(imagePath, bytes);

    const escapedPath = escapePowerShellSingleQuoted(imagePath);

    const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$path = '${escapedPath}'

Import-Module Sixel -ErrorAction Stop
if (-not (Test-Path -LiteralPath $path)) {
  throw "Image path does not exist: $path"
}

$rendered = ConvertTo-Sixel -Path $path -Protocol Sixel -Force
if ([string]::IsNullOrWhiteSpace($rendered)) {
  throw 'ConvertTo-Sixel returned empty output.'
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output $rendered
`;

    const result = runPowerShellCommand(script);
    if (!result.ok) {
      const detail = normalizeText(result.stderr) || normalizeText(result.stdout) || result.reason;
      return {
        error: detail
          ? `Sixel conversion failed: ${detail}`
          : "Sixel conversion failed for an unknown reason.",
      };
    }

    const normalized = normalizeSixelSequence(result.stdout);
    if (!normalized) {
      return { error: "Sixel conversion produced empty output." };
    }

    return { sequence: normalized };
  } catch (error) {
    return { error: `Sixel conversion failed: ${getErrorMessage(error)}` };
  } finally {
    try {
      rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
    }
  }
}
