import { describe, it, expect } from "vitest";
import { EXECUTE_TODOS_SYSTEM_PROMPT } from "./execute-todos-prompt.js";

describe("EXECUTE_TODOS_SYSTEM_PROMPT", () => {
  it("includes the awaiting approval gate stop rule", () => {
    expect(EXECUTE_TODOS_SYSTEM_PROMPT).toContain("AWAITING APPROVAL:");
    expect(EXECUTE_TODOS_SYSTEM_PROMPT).toContain(
      "stop immediately, and exit successfully without running later TODO items",
    );
  });

  it("requires user intent and intent review output", () => {
    expect(EXECUTE_TODOS_SYSTEM_PROMPT).toContain("user_intent.md");
    expect(EXECUTE_TODOS_SYSTEM_PROMPT).toContain("intent-review.md");
    expect(EXECUTE_TODOS_SYSTEM_PROMPT).toContain("### Deviations");
  });

  it("requires stopping immediately after completing the checklist", () => {
    expect(EXECUTE_TODOS_SYSTEM_PROMPT).toContain(
      "After writing `intent-review.md`, stop immediately and exit successfully without doing any more work, exploration, or cleanup",
    );
  });
});
