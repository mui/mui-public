# MUI Public

Mono-repository for the MUI organization with code that can be public.\
See https://github.com/mui/mui-private for code that needs to be private.

## Documentation

You can [read the Infra documentation here](./docs/README.md).

## Applications

### Frontend Public

- URL: [frontend-public.mui.com](https://frontend-public.mui.com/)
- Source: `/apps/code-infra-dashboard/`
- Hosting: https://dashboard.render.com/web/srv-d5fq2j0gjchc73e9st5g
- [Docs](./apps/code-infra-dashboard/#readme)

### MUI Internal

- URL: [mui-internal.netlify.app](https://mui-internal.netlify.app)
- Source: `/docs/`
- Hosting: https://app.netlify.com/projects/mui-internal/overview
- [Docs](./docs/#readme)
- Website for MUI internal packages, e.g. hosts docs-infra.
  This is equivalent to https://backoffice.mui.com/ but for public logic.

## Packages

### [docs-infra](./packages/docs-infra/)

- Source: `/packages/docs-infra/`
- [Docs](./packages/docs-infra/README.md)

### [code-infra](./packages/code-infra/)

- Source: `/packages/code-infra/`
- [Docs](./packages/code-infra/README.md)

## Agent skills

This repo ships agent skills under [`skills/`](./skills/) (e.g. `mui-triage`). Install them into a repo's agent skills directory with the [`skills`](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add mui/mui-public --skill mui-triage
```

Notes:

- Omit `--skill <name>` to install every skill this repo ships.
- Add `-g` to install into the global agent directory, or `--copy` where symlinks aren't supported (e.g. Windows). When a coding agent is detected, the install runs non-interactively.

To refresh installed skills later (`npx skills add` copies the content into your repo):

```bash
npx skills update
```

### Renovate PR workflow

Use [mui-renovate-triage](./skills/mui-renovate-triage/SKILL.md) to fetch a deterministic snapshot of open Renovate PRs and review them one at a time. For each PR, it shows a summary and link, asks whether to merge or continue when CI passes, and runs mui-renovate-fix when CI fails. Follow-up requests continue through the original snapshot without a persistent queue. Request read-only review to skip fixes.

Use [mui-renovate-fix](./skills/mui-renovate-fix/SKILL.md) when you want to implement a dependency-related fix or migration identified during triage, such as an API adaptation, peer dependency mismatch, or reproducible failure caused by an update. It prefers a source-only draft PR when the fix works with both dependency versions. Otherwise, it updates a single-dependency Renovate PR or extracts the culprit bump and adaptation from a grouped PR into a new draft PR. You can also invoke it directly with a Renovate PR URL; it diagnoses the issue first.

For example, ask the agent to "Use mui-renovate-triage to review the open Renovate PRs", then respond with "merge" or "continue" as it presents each passing PR. Visual approval alone, external-service failures, and unrelated flaky tests do not call for a dependency fix.

## Versioning

Steps:

1. Checkout latest master
1. Run `pnpm release:prepare`
1. Run `pnpm release:version`
1. Open PR with the changes

## Publishing

Steps:

1. Merge versioning PR
1. Checkout release commit on master
1. Run `pnpm release:prepare`
1. Run `pnpm release:publish`
