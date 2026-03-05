import { describe, it, expect, vi } from "vitest";
import type { BuiltinStepDef } from "@/workflow/types/index.js";
import { executeBuiltin } from "./builtins.js";

vi.mock("../util/worktree.js", () => ({
  createWorktree: vi.fn(),
}));

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

function makeStep(uses: string): BuiltinStepDef {
  return { kind: "builtin", uses };
}

describe("executeBuiltin", () => {
  it("returns failure for unknown action", async () => {
    const result = await executeBuiltin(
      makeStep("zombieben.unknown_action"),
      {},
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Unknown builtin action");
  });
});
