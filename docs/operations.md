# Operations

## Starting the Runner

```bash
npm run build
zombieben runner start
```

## Useful Paths

- Global runner logs (daily): `~/.zombieben/runner-logs/yyyy-mm-dd.log`
- Per-run log: `~/.zombieben/repos/{repoSlug}/tasks/{worktreeId}/runs/{runId}/run.log`
- Per-step agent logs: `artifacts/step-XXX-claude.stdout.log` and `.stderr.log`

## Common Troubleshooting

### Run not progressing

- Confirm status is `running` in `workflow_state.json`
- Check `run.log` for step transitions
- Check per-step stdout/stderr logs for agent failures

### Wrong responder target

- Inspect run-local `trigger.json`
- Verify it contains full trigger payload (`raw_payload`, `context` where present)
- Ensure `${{ zombieben.trigger }}` in `workflow.resolved.yml` points to this run-local file

### GitHub polling not ingesting events

- Ensure `~/.zombieben/keys.json` has `github.pat`
- Ensure repo slug directory matches `owner--repo`
- Check `~/.zombieben/runner-logs/` for GitHub poll cycle logs
- Optional: tune interval with `ZOMBIEBEN_GITHUB_POLL_INTERVAL_MS`

### Missing TODO

- `TODO.md` is written during `initRun()` to run artifacts
- Legacy runs may still have older behavior; verify run creation timestamp
