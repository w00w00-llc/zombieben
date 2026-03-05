# Ingestor Channel Refactor

## Context

The ingestor pipeline currently splits concerns across three locations:
- `ingestor/sources/` — transform raw events into `Trigger`
- `ingestor/listeners/` — receive raw events from external systems
- `ingestor/ingestor.ts` — orchestrate: look up source by name, transform, dedup, resolve responders

This makes it hard to reason about a single integration end-to-end. Adding a new source requires touching multiple directories and a shared registry.

## Design

### IngestorChannel interface

Each integration gets its own `IngestorChannel` — a self-contained unit that owns its transform logic and listener lifecycle.

```ts
interface IngestorChannel {
  readonly name: string;
  isEnabled(): boolean;
  startListener(): Promise<void>;
  stopListener(): Promise<void>;
}
```

Channels receive an `Ingestor` reference at construction time. They transform raw events into `Trigger` objects themselves, then call `ingestor.submit(trigger)`.

### Simplified Ingestor

The `Ingestor` class drops source lookups. It exposes `submit(trigger)` instead of `ingest(sourceName, rawData)`:

```ts
class Ingestor {
  submit(trigger: Trigger): Promise<void>
  // 1. Dedup check
  // 2. resolveResponders(trigger)
  // 3. onTrigger(result)
}
```

The shared `DedupStore` is passed to the Ingestor at construction. All channels share one dedup store through the single Ingestor instance.

### Directory structure

```
src/ingestor/
  trigger.ts            # Trigger interface
  ingestor-channel.ts   # IngestorChannel interface
  ingestor.ts           # Ingestor class (dedup + resolve)
  dedup-store.ts        # unchanged
  channels/
    index.ts            # getAllChannels(ingestor) registry
    slack/
      index.ts          # createSlackChannel(ingestor): IngestorChannel
      transform.ts      # raw Slack event → Trigger | null
      listener.ts       # SlackSocketListener
    github-webhook/
      index.ts          # createGithubWebhookChannel(ingestor): IngestorChannel
      transform.ts      # raw GitHub webhook → Trigger
    github-poll/
      index.ts          # createGithubPollChannel(ingestor): IngestorChannel
      transform.ts      # raw GitHub poll → Trigger
```

### Runner integration

`start.ts` no longer hardcodes Slack. It starts all enabled channels:

```ts
const channels = getAllChannels(ingestor);
const enabled = channels.filter(ch => ch.isEnabled());
for (const ch of enabled) await ch.startListener();
// shutdown: for (const ch of enabled) await ch.stopListener();
```

### Deleted

- `src/ingestor/sources/` — transforms move into channel directories
- `src/ingestor/listeners/` — listeners move into channel directories
- `src/ingestor/types.ts` — split into `trigger.ts` and `ingestor-channel.ts`
- `TriggerSource` interface — no longer needed; each channel exports a plain transform function

## Key decisions

- **Shared DedupStore**: one store across all channels, prevents cross-channel dupes
- **Channel produces Trigger**: channels own their transform, Ingestor only does dedup + resolve
- **Explicit registry**: hardcoded list in `channels/index.ts`, no auto-discovery
- **GitHub split**: `github-webhook` and `github-poll` are separate channels (different listener lifecycles)
- **GitHub channels disabled**: `isEnabled()` returns false for now (no listener impl yet)
