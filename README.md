# ZombieBen

ZombieBen is an open-source workflow orchestrator that turns chat requests into structured, auditable execution runs.

It ingests triggers (for example from Slack), triages intent, initializes run state, and executes workflow TODOs through a coding agent in isolated worktrees.

## Why ZombieBen

- **Repeatable automation**: encode operational workflows as YAML.
- **Auditability**: every run stores state, trigger snapshot, TODO, and logs.
- **Human-in-the-loop controls**: confirmation requirements and approval gates.
- **Integration-friendly**: supports integration-aware workflow steps.

## How It Works

1. Ingest a trigger from an enabled channel.
2. Triage into a structured outcome (`new_workflow`, `adjustment`, or immediate response).
3. Initialize run metadata and artifacts.
4. Execute workflow slices while persisting run state.
5. Emit notifications/responses and keep full execution logs.

## Repository Layout

- `src/runner/*` — run orchestration (`initRun`, polling ticks, lifecycle)
- `src/engine/*` — workflow parser, TODO generation, execution/state machine
- `src/triage/*` — triage prompts/types/apply/present logic
- `src/integrations/*` — channel and service integrations
- `docs/*` — project documentation (published via GitHub Pages workflow)

## Quickstart

### Prerequisites

- Node.js 18+
- Git

### Install and build

```bash
npm install
npm run build
```

### Initialize workflow scaffolding (inside a target repo)

```bash
zombieben workflows init
zombieben workflows validate
```

### Start runner

```bash
zombieben runner start
```

Useful runner commands:

```bash
zombieben runner status
zombieben runner logs
zombieben runner stop
```

## Documentation

Docs source is in `docs/` with MkDocs config in `mkdocs.yml`.

- GitHub Pages deploy workflow: `.github/workflows/docs-pages.yml`
- PR docs checks: `.github/workflows/docs-check.yml`

To preview docs locally:

```bash
python3 -m pip install mkdocs
mkdocs serve
```

## Development

```bash
npm test
npm run test:watch
npm run lint
npm run build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations and docs update policy.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
