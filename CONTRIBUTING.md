# Contributing

Thanks for contributing to ZombieBen.

## Development Setup

```bash
npm install
npm run build
npm test
```

## Contribution Expectations

- Keep changes focused and test-backed.
- Prefer explicit behavior over implicit side effects.
- Preserve run traceability (state, trigger, artifacts, logs).

## Documentation Policy

If you change behavior in these areas, update docs in the same PR:

- `src/runner/*`
- `src/engine/*`
- `src/triage/*`
- `src/integrations/*`

Docs checks in CI enforce this for core runtime changes.

## Pull Requests

- Include a clear problem statement and expected behavior.
- Include verification steps (tests/build/commands used).
- Call out any behavioral changes affecting existing runs.
