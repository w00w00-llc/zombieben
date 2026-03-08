# Workflows

## Workflow Files

Workflows are YAML files in `.zombieben/workflows/`.

Core fields:

- `name`
- `confirmation_required` (optional)
- `worktree.action` (`create` or `inherit`)
- `inputs`
- `steps`

Notes:

- Workflows do not define trigger routing. Workflow selection is triage-driven.
- Legacy top-level `triggers:` keys are ignored.

## Step Types

- Prompt step (`prompt`)
- Script step (`runs`)
- For-loop step (`for` + nested `steps`)

## Approval Gates

Prompt steps may include:

```yaml
await_approval:
  enabled: ${{ inputs.plan_approval_required }}
  attachments:
    - ${{ artifacts.plan }}
```

Behavior:

- `enabled` is template-resolved at runtime.
- Truthy/falsy values are normalized.
- Invalid values default to `true` (safe behavior).
- TODO rendering inserts a dedicated `AWAITING APPROVAL` task item.

## Runtime Preparation

At run init:

- workflow is resolved into `artifacts/workflow.resolved.yml`
- initial `artifacts/TODO.md` is generated
- trigger snapshot is stored in `trigger.json`

Template contexts typically include:

- `inputs.*`
- `artifacts.*`
- `skills.*`
- `worktree.*`
- `zombieben.trigger`, `zombieben.repo_slug`, `zombieben.main_repo`
