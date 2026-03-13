import { Type } from "@sinclair/typebox";
import type { DelegationMode } from "../types.js";

export const PublicOperationSchema = Type.Object({
  agent: Type.String({ description: "Name of an available agent (must match exactly)" }),
  summary: Type.String({
    minLength: 1,
    pattern: "\\S",
    description: "Short, non-empty summary shown in the delegated run UI.",
  }),
  task: Type.String({ description: "Task description for this delegated run." }),
  cwd: Type.Optional(Type.String({ description: "Optional working directory override." })),
  skill: Type.Optional(Type.String({ description: "Optional single skill override." })),
  delegationMode: Type.Optional(
    Type.Union([Type.Literal("spawn"), Type.Literal("fork")], {
      description: "Optional delegation mode for this operation. Defaults to \"spawn\".",
    }),
  ),
  background: Type.Optional(
    Type.Boolean({
      description: "Optional async execution flag. When true, this operation runs in background. Defaults to false.",
    }),
  ),
});

export const TaskParams = Type.Object({
  mode: Type.Union([Type.Literal("single"), Type.Literal("parallel")], {
    description: "Execution mode. Must be \"single\" or \"parallel\".",
  }),
  operation: Type.Optional(PublicOperationSchema),
  operations: Type.Optional(
    Type.Array(PublicOperationSchema, {
      minItems: 1,
      description: "Parallel operation list. Must be non-empty when mode=parallel.",
    }),
  ),
});

export interface PublicOperation {
  agent: string;
  summary: string;
  task: string;
  cwd?: string;
  skill?: string;
  delegationMode: DelegationMode;
  background: boolean;
}

export interface ValidatedTaskParams {
  mode: "single" | "parallel";
  operations: PublicOperation[];
}
