import { describe, it, expect } from "vitest";
import { EXECUTE_TODOS_SYSTEM_PROMPT } from "./execute-todos-prompt.js";

describe("EXECUTE_TODOS_SYSTEM_PROMPT", () => {
  it("includes the awaiting approval gate stop rule", () => {
    expect(EXECUTE_TODOS_SYSTEM_PROMPT).toContain("AWAITING APPROVAL:");
    expect(EXECUTE_TODOS_SYSTEM_PROMPT).toContain(
      "stop immediately, and exit successfully without running later TODO items",
    );
  });
});
