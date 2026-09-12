# Contributing

## Setup

```bash
npm install && npm run dev
```

## Before opening a pull request

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
```

## Adding a failure pattern

1. Add a rule to `src/engine/classify/rules.ts` with the exact output that
   identifies it, and the repair ids that address it.
2. Add or reuse a repair in `src/engine/repair/`. Repairs must be minimal, say
   why they are correct, and list every file they touch.
3. Add a unit test in `tests/unit/engine.test.ts` using real tool output.
4. If it is demonstrable offline, add a fixture under `fixtures/` and an
   integration test.

## Principles

- Prefer restoring the original environment over modernising the project.
- Never edit a project's tests to make them pass.
- Never report something as verified that was not executed.
