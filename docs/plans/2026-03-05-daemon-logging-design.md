# Daemon Logging

## Summary

Add a shared logger module that writes plain-text timestamped lines to `~/.zombieben/runner.log`. Replace all `console.log`/`console.error` in daemon code paths with the logger. Add a `zombieben runner logs` command to tail the log file.

## Logger module — `src/util/logger.ts`

Singleton that appends to `~/.zombieben/runner.log`. Three levels: `info`, `warn`, `error`.

Format: `[ISO timestamp] [LEVEL] message`

Lazy initialization — file is opened on first write, not on import. Uses `fs.appendFileSync`.

## Log path — `src/util/paths.ts`

`runnerLogPath()` returns `~/.zombieben/runner.log`.

## CLI command — `zombieben runner logs`

Runs `tail -f` on the log file. If file doesn't exist, prints a message and exits.

## What gets logged

All daemon-path output migrates from console to logger:
- **start.ts**: startup, shutdown, PID written
- **orchestrator.ts**: tick errors, step transitions
- **Trigger receipt**: source, type, trigger ID when triage receives a trigger event

CLI-only commands (status, validate, init) keep `console.log` — they aren't daemon operations.

## Non-goals

- Log rotation / max size
- Structured (JSON) format
- External logging library
