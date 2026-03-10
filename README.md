# ZombieBen

ZombieBen is a simple tool for getting agents to run predefined workflows. It ingests triggers (e.g. a Slack message or GitHub action run completion), triages it to a predefined workflow, and executes that workflow in an isolated worktree.

## Why ZombieBen

- ✅ **Cost control**. No runaway token costs. The only thing it needs is for Claude Code or Codex to be installed on the host machine, which you can use subscription-based cost for
- ✅ **Deterministic agent behavior**. Workflows are defined in your repo; ZombieBen's engine makes sure every step is completed
- ✅ **Human-in-the-loop** controls. You can add approval gates to any workflow, requiring a human to approve running or continuing a workflow
- ✅ **Context-aware workflows**. Supports integration-aware workflow steps if you need to pull context from Figma, Linear, etc
- ✅ **Easy transition from Claude Code**. If you're a developer already using Claude Code, ZombieBen just takes your current workflow with Claude Code, and does it for you. All you need to do is set up a runner (this can just be your own machine) with the integrations it needs, and it can start running workflows.

## How It Works

ZombieBen works a lot like GitHub Actions:

1. You set up a long-running ZombieBen runner with the integrations it needs, such as Slack, GitHub, Linear, or Figma.
2. In each repo, you define `.zombieben/` workflows and worktree behavior.
3. ZombieBen ingests a trigger from an enabled channel.
4. It triages the request into a structured outcome (`new_workflow`, `adjustment`, or immediate response).
5. It initializes run metadata and artifacts, then executes the matching workflow in an isolated worktree.
6. It emits notifications/responses and keeps full execution logs for the run.

## Quickstart

### Runner

Prerequisites:

- Node.js 18+
- Git
- Claude Code installed and set up on the runner machine

Install from npm:

```bash
npm install -g @w00w00/zombieben
```

Runner setup and operation:

- `zombieben runner chat` is how you get integrations and runner config set up. Just talk to it: it opens Claude Code in `~/.zombieben` and knows how to get ZombieBen configured for you.
- `zombieben runner start` starts the ZombieBen runner.

### Repo

Inside a target git repo, scaffold `.zombieben/`:

```bash
zombieben workflows init
```

Repo layout:

- `.zombieben/worktrees.yml` defines how ZombieBen should create and prepare worktrees for runs.
- `.zombieben/workflows/` is where your workflow `.yml` files live.
- `.zombieben/rules.md` can be added to capture repo-specific guidance for agents.
- Look in `example_workflows/` in this repo for example workflows you can copy and adapt into `.zombieben/workflows/`.

## Command Reference

Top-level commands:

- `zombieben --help` or `zombieben help [command]` — show CLI help
- `zombieben --version` — print the installed CLI version
- `zombieben runner` — runner daemon and management commands
- `zombieben workflows` — workflow scaffolding and validation commands
- `zombieben update` — sync install-provided files without clobbering user data

Runner commands:

- `zombieben runner chat` — open Claude Code in `~/.zombieben`
- `zombieben runner logs` — tail the runner daemon log
- `zombieben runner start` — start the runner in the foreground
- `zombieben runner start --daemon` — start the runner in the background
- `zombieben runner status` — show all workflow run statuses
- `zombieben runner stop` — stop the runner daemon

Workflow commands:

- `zombieben workflows init` — scaffold `.zombieben/` in the current git repo
- `zombieben workflows validate` — validate `.zombieben/workflows/*.yml` and `worktrees.yml`
- `zombieben workflows validate --dir /path/to/repo` — validate a repo without running from its root

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations and docs update policy.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
