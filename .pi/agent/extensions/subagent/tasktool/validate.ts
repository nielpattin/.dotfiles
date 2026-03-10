import { DEFAULT_DELEGATION_MODE } from "../types.js";
import type { PublicOperation, ValidatedTaskParams } from "./schema.js";

function hasNonBlankText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validatePublicOperation(raw: unknown, label: string):
  | { ok: true; operation: PublicOperation }
  | { ok: false; message: string } {
  if (!isRecord(raw)) {
    return { ok: false, message: `${label} must be an object.` };
  }

  if (raw.skills !== undefined) {
    return { ok: false, message: `${label} uses unsupported field \`skills\`. Use singular \`skill\` string only.` };
  }
  if (raw.extension !== undefined || raw.extensions !== undefined) {
    return {
      ok: false,
      message: `${label} cannot include \`extension\` or \`extensions\`. Configure extensions in /task-config instead.`,
    };
  }

  if (!hasNonBlankText(raw.agent) || !hasNonBlankText(raw.summary) || !hasNonBlankText(raw.task)) {
    return { ok: false, message: `${label} requires non-empty \`agent\`, \`summary\`, and \`task\`.` };
  }
  if (raw.cwd !== undefined && typeof raw.cwd !== "string") {
    return { ok: false, message: `${label}.cwd must be a string when provided.` };
  }
  if (raw.skill !== undefined && !hasNonBlankText(raw.skill)) {
    return { ok: false, message: `${label}.skill must be a non-empty string when provided.` };
  }
  if (
    raw.delegationMode !== undefined
    && raw.delegationMode !== "spawn"
    && raw.delegationMode !== "fork"
  ) {
    return {
      ok: false,
      message: `${label}.delegationMode must be \"spawn\" or \"fork\" when provided.`,
    };
  }

  return {
    ok: true,
    operation: {
      agent: raw.agent.trim(),
      summary: raw.summary.trim(),
      task: raw.task,
      ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
      ...(typeof raw.skill === "string" ? { skill: raw.skill.trim() } : {}),
      delegationMode: raw.delegationMode === "fork" ? "fork" : DEFAULT_DELEGATION_MODE,
    },
  };
}

export function validateTaskToolParams(raw: unknown):
  | { ok: true; value: ValidatedTaskParams }
  | { ok: false; message: string } {
  if (!isRecord(raw)) {
    return { ok: false, message: "Invalid parameters. Expected an object payload." };
  }

  if (raw.mode === "spawn" || raw.mode === "fork") {
    return {
      ok: false,
      message: "Legacy mode values `spawn|fork` are no longer supported. Use `mode: \"single\"` or `mode: \"parallel\"`.",
    };
  }

  if (raw.tasks !== undefined) {
    return {
      ok: false,
      message: "Legacy `tasks` payload is no longer supported. Use `{ mode: \"single\", operation: {...} }` or `{ mode: \"parallel\", operations: [...] }`.",
    };
  }

  if (raw.agent !== undefined || raw.task !== undefined || raw.summary !== undefined) {
    return {
      ok: false,
      message: "Top-level `{ agent, summary, task }` is not supported. Wrap it under `operation` with `mode: \"single\"`.",
    };
  }

  if (raw.extension !== undefined || raw.extensions !== undefined) {
    return {
      ok: false,
      message: "`extension`/`extensions` are not allowed in task payloads. Configure extensions in /task-config.",
    };
  }

  if (raw.skills !== undefined) {
    return {
      ok: false,
      message: "`skills` is not supported in task payloads. Use singular `skill` on each operation.",
    };
  }

  if (!hasNonBlankText(raw.mode)) {
    return { ok: false, message: "`mode` is required and must be `single` or `parallel`." };
  }

  const mode = raw.mode.trim().toLowerCase();
  if (mode !== "single" && mode !== "parallel") {
    return { ok: false, message: `Invalid mode "${String(raw.mode)}". Expected "single" or "parallel".` };
  }

  if (mode === "single") {
    if (raw.operations !== undefined) {
      return { ok: false, message: "`operations` is not allowed when mode is `single`. Use `operation` only." };
    }
    if (raw.operation === undefined) {
      return { ok: false, message: "mode `single` requires `operation`." };
    }

    const validated = validatePublicOperation(raw.operation, "operation");
    if (!validated.ok) return validated;
    return { ok: true, value: { mode: "single", operations: [validated.operation] } };
  }

  if (raw.operation !== undefined) {
    return { ok: false, message: "`operation` is not allowed when mode is `parallel`. Use `operations` only." };
  }
  if (!Array.isArray(raw.operations) || raw.operations.length === 0) {
    return { ok: false, message: "mode `parallel` requires non-empty `operations`." };
  }

  const operations: PublicOperation[] = [];
  for (const [index, item] of raw.operations.entries()) {
    const validated = validatePublicOperation(item, `operations[${index}]`);
    if (!validated.ok) return validated;
    operations.push(validated.operation);
  }

  return { ok: true, value: { mode: "parallel", operations } };
}
