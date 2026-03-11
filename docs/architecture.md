# Architecture

## High-Level Flow

1. Ingest trigger from channel (Slack, etc.)
2. Triage trigger into a structured outcome
3. Initialize run state and artifacts
4. Poll active runs and execute workflow slices
5. Persist state/logs/artifacts and emit responder messages

## Main Components

- `src/ingestor/*`: listens for channel events and normalizes triggers
- `src/triage/*`: produces a `TriageOutcome`
- `src/runner/init-run.ts`: creates run directories, trigger snapshot, resolved workflow snapshot, initial `TODO.md`
- `src/runner/tick.ts`: scans active runs and advances them
- `src/engine/workflow-runner.ts`: executes workflow slices and advances state machine
- `src/integrations/*`: channel/integration adapters

## Runtime Layout

Under `~/.zombieben/repos/{repoSlug}/tasks/{worktreeId}/runs/{runId}/`:

- `workflow_state.json`
- `trigger.json`
- `inputs.json`
- `user_intent.md`
- `run.log`
- `artifacts/`
  - `TODO.md`
  - `workflow.resolved.yml`
  - `intent-review.md`
  - `step-XXX-claude.stdout.log`
  - `step-XXX-claude.stderr.log`

At the worktree root `~/.zombieben/repos/{repoSlug}/tasks/{worktreeId}/`:

- `repo/`
- `runs/`
- `worktree_metadata.json`

## Execution Model

- The runner processes runs where `workflow_state.status == "running"`.
- A slice execution may complete multiple TODO items in one agent session.
- If TODO main section is fully complete, run is marked completed.
- Approval gates can transition a run to `awaiting_approval`.
