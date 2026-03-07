# Integrations

Integrations are external services that plug into ZombieBen's architecture. Each integration can fill one or more of three roles:

- **Triggers** — Ingestor channels that listen for external events and produce `Trigger` objects (e.g. Slack Socket Mode, GitHub webhook polling)
- **Notifications** — Responders that send messages back to users (e.g. Slack thread replies, emoji reactions)
- **Workflow tooling** — Services called from within workflow steps (e.g. GitHub PR creation, Linear issue fetching)

## Current integrations

| Integration | Triggers | Notifications | Workflow tooling |
| ----------- | -------- | ------------- | ---------------- |
| Slack       | ✓        | ✓             |                  |
| GitHub      | ✓        |               | ✓                |
| Linear      |          |               | ✓                |
| Figma       |          |               | ✓                |

## Directory conventions

Each integration lives in its own subdirectory (e.g. `slack/`, `github/`). Integration-specific setup instructions go in an `INTEGRATION.md` file at the root of that subdirectory. ZombieBen uses the INTEGRATIONS.md file to help humans set their integrations up.

## Key interfaces

- **`IngestorChannel`** (`src/ingestor/ingestor-channel.ts`) — Contract for trigger integrations. Implements `startListener`/`stopListener` lifecycle and produces `Trigger` objects for the ingestor.
- **`TriggerResponder`** (`src/responder/responder.ts`) — Contract for notification integrations. Provides `send`, `edit`, `react`, and `unreact`.
