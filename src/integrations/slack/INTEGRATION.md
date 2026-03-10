# Setup Slack

Connect ZombieBen to a Slack workspace.

## Prerequisites

The user needs a Slack app with a **Bot Token** (`xoxb-...`). If they don't have one yet, walk them through it:

1. Go to https://api.slack.com/apps and click **Create New App** → **From scratch**.
2. Name it (e.g. "ZombieBen") and pick the workspace.
3. Under **OAuth & Permissions**, add these **Bot Token Scopes**:
   - `app_mentions:read` — detect when the bot is @mentioned
   - `channels:history` — read messages in public channels
   - `channels:read` — list public channels
   - `files:write` — upload approval artifacts and other attachments
   - `groups:history` — read messages in private channels
   - `im:history` — read direct messages
   - `chat:write` — send messages
   - `connections:write` — connect via Socket Mode
   - `reactions:read` — read emoji reactions
   - `reactions:write` — add emoji reactions
4. Under **Settings → Socket Mode**, enable Socket Mode.
5. Generate an **app-level token** with the `connections:write` scope. Copy it (`xapp-...`).
6. Under **Event Subscriptions**, enable events and subscribe to these **bot events** (under **Subscribe to bot events**):
   - `message.channels` — receive messages in public channels
   - `message.groups` — receive messages in private channels
   - `message.im` — receive direct messages
7. Click **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-...`).

## Setup Flow

1. Ask the user for their Slack **bot token** (`xoxb-...`).
2. Ask the user for their Slack **app-level token** (`xapp-...`).
3. Write both to `keys.json` under the `slack` integration:

```json
{
  "slack": {
    "bot_token": "xoxb-...",
    "app_token": "xapp-..."
  }
}
```

Use the `setIntegrationKeys` helper (or write `keys.json` directly):

```
setIntegrationKeys("slack", { bot_token: "<bot_token>", app_token: "<app_token>" })
```

4. Confirm both tokens were saved and remind the user which channel(s) to invite the bot to (`/invite @ZombieBen` in the channel).
5. Explain that `zombieben runner start` will now listen for @mentions via Socket Mode.
