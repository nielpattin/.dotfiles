import { describe, expect, it, vi } from "vitest";
import { createTaskAbortRegistry } from "./task-abort-registry.js";

describe("task abort registry", () => {
  it("registers and aborts by child session id", () => {
    const registry = createTaskAbortRegistry();
    const abort = vi.fn();

    registry.register(" child-1 ", abort);

    expect(registry.has("child-1")).toBe(true);
    expect(registry.abort("child-1")).toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("unregister removes active abort handlers", () => {
    const registry = createTaskAbortRegistry();
    const abort = vi.fn();

    registry.register("child-1", abort);
    registry.unregister("child-1");

    expect(registry.has("child-1")).toBe(false);
    expect(registry.abort("child-1")).toBe(false);
    expect(abort).not.toHaveBeenCalled();
  });
});
