# ZombieBen Documentation

ZombieBen is a workflow runner that triages incoming triggers, initializes workflow runs, and executes workflow TODOs through a coding agent.

## What This Docs Site Covers

- System architecture and runtime flow
- Workflow authoring model (`.zombieben/workflows/*.yml`)
- Operational behavior (run layout, logs, troubleshooting)

## Repository Conventions

- Runtime data lives under `~/.zombieben/`
- Workflow definitions live in each repo under `.zombieben/workflows/`
- Worktree setup defaults live under `.zombieben/worktrees.yml`

## Keeping Docs Current

Documentation is treated as part of the code:

- A PR check validates docs build.
- A PR check enforces docs updates when core runtime code changes.

If you modify behavior in `src/runner`, `src/engine`, `src/triage`, or integrations, update the corresponding docs page in this site.
