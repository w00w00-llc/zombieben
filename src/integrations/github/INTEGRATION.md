# GitHub Integration

ZombieBen supports two GitHub trigger channels:

- `github-webhook` (recommended): local webhook listener, typically fed by a tunnel relay
- `github-poll` (fallback): periodic polling of repo events

## Keys

Configure GitHub integration in `~/.zombieben/keys.json`:

```json
{
  "github": {
    "pat": "ghp_...",
    "webhook_enabled": "true",
    "webhook_secret": "replace-with-random-secret",
    "webhook_port": "8787",
    "webhook_path": "/integrations/github/webhook",
    "webhook_public_url": "https://example-tunnel-url",
    "webhook_tunnel_mode": "cloudflare"
  }
}
```

Notes:

- Polling uses `pat` (fallback keys: `token`, `api_key`).
- Webhook listener requires `webhook_enabled` + `webhook_secret`.

## Webhook Setup (local/basic runner)

1. Start runner locally (listener binds to `127.0.0.1` on `webhook_port`).
2. Run a tunnel relay (Cloudflare/ngrok/smee) that forwards to:
   - `http://127.0.0.1:{webhook_port}{webhook_path}`
3. In each GitHub repo, configure a webhook:
   - Payload URL: `{public_tunnel_url}{webhook_path}`
   - Content type: `application/json`
   - Secret: `webhook_secret`
   - Events:
     - `issues`
     - `issue_comment`
     - `pull_request`
     - `pull_request_review`
     - `pull_request_review_comment`

## Polling Fallback

- Poll interval defaults to 30 seconds (`ZOMBIEBEN_GITHUB_POLL_INTERVAL_MS` to override).
- Poller uses `repo-config.yml` `github_url` as source-of-truth for owner/repo.
- If `github_url` is missing, falls back to slug inference (`owner--repo`).

Webhook and poll can run together; duplicate near-simultaneous GitHub events are suppressed with a short TTL by event/group key.

## Notes

- GitHub notification responder is currently a no-op.
- Accepted events are still triaged and can trigger workflows and Slack notifications.
