# ZombieBen

ZombieBen is a simple tool for getting agents to run predefined workflows. It ingests triggers (e.g. a Slack message or GitHub action run completion), triages it to a predefined workflow, and executes that workflow in an isolated worktree.

## Why ZombieBen

- ✅ Cost control. No runaway token costs. The only thing it needs is for Claude Code or Codex to be installed on the host machine, which you can use subscription-based cost for
- ✅ Deterministic workflow runs. Workflows are defined in your repo; ZombieBen's engine makes sure every step is completed
- ✅ Human-in-the-loop controls. You can add approval gates to any workflow, requiring a human to approve running or continuing a workflow
- ✅ Integration-friendly. Supports integration-aware workflow steps if you need to pull context from Figma, Linear, etc

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

### Install from npm

```bash
npm install -g @w00w00/zombieben
```

### Build from source

```bash
npm install
npm run build
```

### Initialize workflow scaffolding (inside a target repo)

```bash
zombieben workflows init
zombieben workflows validate
```

Useful runner commands:

```bash
zombieben runner start
zombieben runner status
zombieben runner logs
zombieben runner stop
```

## Publishing

### First-time npm setup

```bash
npm login
npm whoami
```

This package is configured for public scoped publishing as `@w00w00/zombieben`.

### Verify the publish artifact locally

```bash
npm run build
npm run lint
npm test
npm pack --dry-run --cache /tmp/zombieben-npm-cache
```

To test the exact tarball before publishing:

```bash
PACKAGE_TGZ="$(npm pack --cache /tmp/zombieben-npm-cache)"
npm install -g "./$PACKAGE_TGZ"
zombieben --version
```

### Publish a release

```bash
npm version patch
npm publish
```

Use `minor` or `major` instead of `patch` when appropriate. The package sets `publishConfig.access=public`, so the default `npm publish` command targets the public npm registry.

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
npm install
npm test
npm run test:watch
npm run lint
npm run build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations and docs update policy.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
