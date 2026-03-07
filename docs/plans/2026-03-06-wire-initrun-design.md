# Wire initRun into Runner Loop — Design

> Approved design doc. See `2026-03-06-wire-initrun.md` for implementation plan.

## Goal

Connect the triage outcome to actual workflow execution by calling `initRun` when a workflow is confirmed.

## Architecture

`presentOutcome` returns a `PresentResult` instead of `void`. The runner's `handleTrigger` checks the result and calls `initRun` when `shouldRun` is true. The next `processTick` picks up the new run.

## Flow

```
triage → applyOutcome → presentOutcome (returns PresentResult) → initRun (if shouldRun)
```

## PresentResult

```typescript
interface PresentResult {
  shouldRun: boolean;
  resolution?: { repoSlug, workflowFile, workflowName, inputs, worktreeId? };
}
```

- `run` → sends message, returns `{ shouldRun: true, resolution }`
- `confirm` → prompts user, returns `{ shouldRun: true/false, resolution }`
- `suggest` → prompts user with options, returns `{ shouldRun: true, resolution }`
- `immediate_response` / `in_progress_workflow_adjustment` → `{ shouldRun: false }`

## Error Handling

If `initRun` throws, the runner catches and sends the error via responder (existing pattern).

## Files

- Modify: `src/triage/present.ts`
- Modify: `src/triage/present.test.ts`
- Modify: `src/runner/index.ts`
