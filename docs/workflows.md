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
- For-loop step (`foreach` + nested `steps`)
- Nested workflow step (`workflow.name` + optional `workflow.inputs`)

Example nested workflow step:

```yaml
- name: Maybe inline nested workflow
  if: The value in ./outer.txt is greater than 0.5
  workflow:
    name: ./nested-inner.yml
    inputs:
      number: "{The value in ./outer.txt}"
```

Nested workflows are expanded inline during workflow loading. The parent
workflow step does not remain as a runtime step; its condition is applied to
the injected child steps.

Workflow files are also exposed as a template namespace. A workflow file
`capture-screen-recordings.yml` can be referenced as
`${{ workflows.capture-screen-recordings }}`. Nested directories are exposed
as nested objects, so `mobile/capture.yml` becomes
`${{ workflows.mobile.capture }}`.

Each worktree also has a `worktree_metadata.json` file stored alongside
`repo/` and `runs/` under `repos/{repoSlug}/tasks/{worktreeId}/`.
Workflow templates can read values from this file using
`${{ worktree_metadata.some_key }}`. The current worktree metadata file path is
available as `${{ worktree.metadata_path }}` for workflows that need to update
the JSON file.

## Conditions

Steps may use:

- `if: success`
- `if: failure`
- `if: always`
- `if: <freeform text>`

Freeform `if` values are treated as success-path steps plus an additional
agent-evaluable condition. In TODO rendering, the agent is instructed to
execute the step only if the freeform condition is true; otherwise it should
mark the item skipped and continue.

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

## Required Integrations

Prompt steps may declare required integrations as a map keyed by integration
name:

```yaml
required_integrations:
  github:
    permissions:
      - pull-requests: write
  linear:
```

The compact empty form like `github:` is valid.

## Runtime Preparation

At run init:

- workflow is resolved into `artifacts/workflow.resolved.yml`
- initial `artifacts/TODO.md` is generated
- trigger snapshot is stored in `trigger.json`

Template contexts typically include:

- `inputs.*`
- `artifacts.*`
- `skills.*`
- `workflows.*`
- `worktree_metadata.*`
- `worktree.*`
- `zombieben.trigger`, `zombieben.repo_slug`, `zombieben.main_repo`
