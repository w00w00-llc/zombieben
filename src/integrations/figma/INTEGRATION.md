# Setup Figma

Connect ZombieBen to Figma for fetching design files and components in workflow steps.

## Prerequisites

The user needs a Figma **personal access token**. If they don't have one:

1. Go to **Settings → Account → Personal access tokens** (e.g. `https://www.figma.com/settings` under the Account tab).
2. Click **Generate new token**.
3. Give it a description (e.g. "ZombieBen").
4. Copy the token (`figd_...`).

## Setup Flow

1. Ask the user for their Figma **personal access token** (`figd_...`).
2. Write it to `keys.json` under the `figma` integration:

```json
{
  "figma": {
    "api_key": "figd_..."
  }
}
```

Use the `setIntegrationKeys` helper:

```
setIntegrationKeys("figma", { api_key: "<token>" })
```

3. (Optional) Configure an MCP server in `integrations.json`:

```json
{
  "figma": {
    "mcp": {
      "command": "npx",
      "args": ["-y", "@anthropic/figma-mcp-server"],
      "env": { "FIGMA_API_KEY": "$api_key" }
    },
    "env_var": "FIGMA_API_KEY"
  }
}
```

If no MCP server is configured, the coding agent will receive the API key as the `FIGMA_API_KEY` environment variable and can use the Figma API directly.

4. Confirm the key was saved. Workflows with `required_integrations: { figma: {} }` will now work.
