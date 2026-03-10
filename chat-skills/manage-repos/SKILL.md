---
name: manage-repos
description: Use when user wants to add, list, update, or remove a GitHub repo integration in ZombieBen
---

# Manage Repos

Add, list, update, or remove repo integrations.

## Repo Structure

```
repos/
  <org>-<repo>/
    repo-config.yml
    main_repo/          # Cloned git repo
```

Slug is derived from the GitHub URL: `github.com/acme/widgets` becomes `acme-widgets`.

## repo-config.yml

```yaml
github_url: https://github.com/acme/widgets
env:
  API_URL: https://api.example.com
  SECRET_TOKEN: super-secret
```

`env` is optional. When present, ZombieBen writes those key/value pairs into the
root `.env` file for newly created worktrees for that repo. Credentials for
integrations still live in `keys.json`.

## GitHub PAT

The GitHub personal access token is stored in `keys.json` under the `github` integration:

```json
{
  "github": {
    "pat": "ghp_..."
  }
}
```

## Adding a Repo

1. Ask the user for the GitHub URL.
2. Check `keys.json` for `github.pat`. If missing, ask the user for their GitHub personal access token and save it:
   ```
   setIntegrationKeys("github", { pat: "<token>" })
   ```
3. Derive slug from URL.
4. Create `repos/<slug>/`.
5. Write `repo-config.yml` with `github_url`, plus optional `env` values if the
   user wants worktree-local `.env` overrides.
6. Clone the repo: `git clone https://<pat>@github.com/<org>/<repo>.git repos/<slug>/main_repo`

## Listing Repos

List directories under `repos/` and read each `repo-config.yml`. For each repo, also show:

### Repo Status

1. Read `github_url` from `repo-config.yml`.
2. Scan `repos/<slug>/main_repo/.zombieben/workflows/*.yml` for `triggers:` sections.
3. List which integrations are referenced and their trigger types
4. Show whether `keys.json` has credentials for each referenced integration.

Example output:

```
acme-widgets
  URL: https://github.com/acme/widgets
  Workflows:
    triage.yml — Triggers: slack (new_thread, existing_thread) ✓ configured
    deploy.yml — Triggers: github (check_suite) ✗ no keys
```

### Integrations Overview

When listing repos, also show a summary of all configured integrations:

1. Read `keys.json` and list each integration's key names (not values).
2. For each integration, note which repos reference it in their workflow triggers.

Example output:

```
Integrations:
  slack: configured (keys: bot_token) — used by: acme-widgets
  github: configured (keys: pat) — used by: acme-widgets, my-org-backend
```

## Removing a Repo

Confirm with user, then delete the repo directory under `repos/`.
