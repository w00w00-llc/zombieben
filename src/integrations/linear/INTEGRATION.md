# Setup Linear

Connect ZombieBen to Linear for fetching issues in workflow steps.

## Prerequisites

The user needs a Linear **API key**. If they don't have one:

1. Go to **Settings → Account → Security & Access** (e.g. `https://linear.app/<workspace>/settings/account/security`).
2. Under **API**, click **Create key**.
3. Give it a label (e.g. "ZombieBen").
4. Copy the key (`lin_api_...`).

## Setup Flow

1. Ask the user for their Linear **API key** (`lin_api_...`).
2. Write it to `keys.json` under the `linear` integration:

```json
{
  "linear": {
    "api_key": "lin_api_..."
  }
}
```

Use the `setIntegrationKeys` helper:

```
setIntegrationKeys("linear", { api_key: "<api_key>" })
```

3. (Optional) Configure an MCP server in `integrations.json`:

```json
{
  "linear": {
    "mcp": {
      "command": "npx",
      "args": ["-y", "@linear/mcp-server"],
      "env": { "LINEAR_API_KEY": "$api_key" }
    },
    "env_var": "LINEAR_API_KEY"
  }
}
```

If no MCP server is configured, the coding agent will receive the API key as the `LINEAR_API_KEY` environment variable and can use the Linear API directly.

4. Confirm the key was saved. Workflows with `required_integrations: [linear:]` will now work.
