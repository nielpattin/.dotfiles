import { renderTemplate } from "./config.js";
import { execShell, type ExecFunction } from "./shell.js";

export interface PreviewResult {
  lines: string[];
  error: string | null;
}

/**
 * Run a preview command and return the output lines or error.
 */
export async function runPreviewCommand(
  exec: ExecFunction,
  template: string,
  selected: string,
): Promise<PreviewResult> {
  const rendered = renderTemplate(template, selected);

  const result = await execShell(exec, rendered, { timeout: 5000 });

  if (result.code !== 0) {
    return {
      lines: [],
      error:
        (result.stderr || result.stdout).trim() || `Exit code ${result.code}`,
    };
  }

  const lines = result.stdout
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  return {
    lines,
    error: null,
  };
}
