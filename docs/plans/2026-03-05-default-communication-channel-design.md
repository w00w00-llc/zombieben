# Default Communication Channel

## Problem

Different triggers have different responders (Slack mention → Slack thread, GitHub event → GitHub). But there's no way for ZombieBen to broadcast lifecycle updates (started, completed, failed) to a central place. Users want a single global channel where all workflow activity is visible.

## Design

### Notifier interface

A `Notifier` interface decouples lifecycle notifications from any specific backend:

```ts
interface Notifier {
  workflowStarted(repoSlug: string, workflowName: string, worktreeId: string): Promise<void>;
  workflowCompleted(repoSlug: string, workflowName: string, worktreeId: string): Promise<void>;
  workflowFailed(repoSlug: string, workflowName: string, worktreeId: string, error: string): Promise<void>;
}
```

A `CompositeNotifier` fans out to all configured backends. A `NoopNotifier` is used when nothing is configured.

### SlackNotifier

The first (and currently only) implementation. Posts to a configured global Slack channel.

### Configuration

Stored in `keys.json`:

```json
{
  "slack": {
    "bot_token": "xoxb-...",
    "app_token": "xapp-...",
    "notification_channel": "C0123456789"
  }
}
```

If `notification_channel` is not set, `createSlackNotifier()` returns `null` and notifications are silently skipped.

### Integration points

1. **`initRun()`** — after writing `workflow_state.json`, calls `notifier.workflowStarted()` and `responder.send()` (to the trigger thread).

2. **`processRun()` in orchestrator** — after `advanceWorkflow()`, if state is `completed` or `failed`, calls the appropriate notifier method. Also reconstructs a responder from `trigger.json` to post to the trigger thread.

3. **Daemon startup** — creates the notifier once, passes it into `processTick()`.

### Lifecycle updates go to both places

- The **global channel** gets a broadcast message (via notifier).
- The **trigger thread** gets an update (via responder).

### Messages

Simple text:
- `:rocket: Workflow "Fix Bug" started (my-org--my-repo/fix-bug-1709654321)`
- `:white_check_mark: Workflow "Fix Bug" completed (my-org--my-repo/fix-bug-1709654321)`
- `:x: Workflow "Fix Bug" failed: Step timed out (my-org--my-repo/fix-bug-1709654321)`

## File changes

**New:**
- `src/notifications/notifier.ts` — `Notifier` interface, `CompositeNotifier`, `NoopNotifier`
- `src/notifications/slack.ts` — `SlackNotifier`, `createSlackNotifier()`

**Modified:**
- `src/runner/init-run.ts` — accepts `Notifier` and `TriggerResponder`
- `src/runner/orchestrator.ts` — `processTick(notifier)`, calls notifier on terminal states, reconstructs responder from `trigger.json`
- `src/commands/runner/start.ts` — creates notifier at startup
- `src/listeners/slack.ts` — passes notifier and responder into `initRun()`
- `chat-skills/setup-slack/SKILL.md` — adds `notification_channel` setup

**Unchanged:**
- `TriggerResponder` interface
- `SlackResponder`

## Future extensibility

Adding a new notification backend (Telegram, Discord, etc.) means implementing the `Notifier` interface and registering it in the `CompositeNotifier`. No changes to the orchestrator or other existing code.
