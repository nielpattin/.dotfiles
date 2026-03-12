import { afterEach, describe, expect, it } from "vitest";
import { TASK_ENV_NAMES } from "../constants.js";
import { resolveDelegationDepthConfig } from "./settings.js";

const ORIGINAL_DEPTH_ENV = process.env[TASK_ENV_NAMES.depth];

function setDepthEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env[TASK_ENV_NAMES.depth];
    return;
  }
  process.env[TASK_ENV_NAMES.depth] = value;
}

afterEach(() => {
  setDepthEnv(ORIGINAL_DEPTH_ENV);
});

describe("resolveDelegationDepthConfig", () => {
  it("allows delegation for root process when depth env is missing", () => {
    setDepthEnv(undefined);

    const config = resolveDelegationDepthConfig({} as any);

    expect(config.currentDepth).toBe(0);
    expect(config.canDelegate).toBe(true);
  });

  it("allows delegation only at depth 0", () => {
    setDepthEnv("0");
    expect(resolveDelegationDepthConfig({} as any).canDelegate).toBe(true);

    setDepthEnv("1");
    expect(resolveDelegationDepthConfig({} as any).canDelegate).toBe(false);
  });

  it("blocks delegation when depth env is malformed", () => {
    setDepthEnv("not-a-number");

    const config = resolveDelegationDepthConfig({
      getFlag: () => {
        throw new Error("max depth flag should not be read");
      },
    } as any);

    expect(config.currentDepth).toBe(0);
    expect(config.canDelegate).toBe(false);
  });
});
