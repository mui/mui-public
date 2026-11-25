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
- Website for MUI internal packages, for example, hosts docs-infra.
  This is equivalent to https://backoffice.mui.com/ but for public logic.

## Packages

### [docs-infra](./packages/docs-infra/)

- Source: `/packages/docs-infra/`
- [Docs](./packages/docs-infra/README.md)

### [code-infra](./packages/code-infra/)

- Source: `/packages/code-infra/`
- [Docs](./packages/code-infra/README.md)

## Agent skills

This repo ships agent skills under [`skills/`](./skills/) (for example, `mui-triage`). Install them into a repo's agent skills directory with the [`skills`](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add mui/mui-public --skill mui-triage
```

Notes:

- Omit `--skill <name>` to install every skill this repo ships.
- Add `-g` to install into the global agent directory, or `--copy` where symlinks aren't supported (for example, Windows). When a coding agent is detected, the install runs non-interactively.

To refresh installed skills later (`npx skills add` copies the content into your repo):

```bash
npx skills update
```

In Claude Code, you can install them as a plugin instead, which tracks `master` without copying files into your repo. Run this inside the repo where you want the skills:

```bash
claude plugin marketplace add mui/mui-public
claude plugin install code-infra@mui-public --scope local
```

The skills are then available as `/code-infra:<skill>` (for example, `/code-infra:mui-renovate-triage`). They're enabled only for you and only in that repo: `--scope local` records this in `.claude/settings.local.json`, which isn't committed. Use `--scope user` to enable them in every repo instead. To stay on the latest `master`, enable auto-update for the `mui-public` marketplace under `/plugin` → **Marketplaces**, or run `claude plugin update code-infra@mui-public`.

To enable the skills for everyone who works in a repo, use `--scope project`, which writes to the committed `.claude/settings.json`. Also add the marketplace there, so Claude Code knows where to install the plugin from for teammates who haven't added it:

```json
{
  "extraKnownMarketplaces": {
    "mui-public": {
      "source": { "source": "github", "repo": "mui/mui-public" }
    }
  },
  "enabledPlugins": {
    "code-infra@mui-public": true
  }
}
```

### Renovate PR workflow

Use [mui-renovate-triage](./skills/mui-renovate-triage/SKILL.md) to fetch a deterministic snapshot of open Renovate PRs and review them one at a time. For each PR, it shows a summary and link, asks whether to merge or continue when CI passes, and runs mui-renovate-fix when CI fails. Follow-up requests continue through the original snapshot without a persistent queue. Request read-only review to skip fixes.

Use [mui-renovate-fix](./skills/mui-renovate-fix/SKILL.md) when you want to implement a dependency-related fix or migration identified during triage, such as an API adaptation, peer dependency mismatch, or reproducible failure caused by an update. It picks the best adaptation first, then opens a source-only draft PR when that fix works with both dependency versions. Otherwise, it updates a single-dependency Renovate PR or extracts the culprit bump and adaptation from a grouped PR into a new draft PR. You can also invoke it directly with a Renovate PR URL; it diagnoses the issue first.

For example, ask the agent to "Use mui-renovate-triage to review the open Renovate PRs", then respond with "merge" or "continue" as it presents each passing PR. Visual approval alone, external-service failures, and unrelated flaky tests do not call for a dependency fix.

## Agentic workflows

### Dependabot alerts

The reusable [Dependabot fix workflow](./.github/workflows/dependabot-fix-workflow.md) (GitHub Agentic Workflows) clears the open Dependabot security alerts that dependency-update tooling leaves open, typically vulnerable transitive dependencies. Per package, an agent picks the least invasive fix the dependency policy allows. It batches the fixes within current major versions into one PR and gives each major-version fix its own, and reports in an issue the alerts that need a decision. Alerts that are deliberately left unfixed should be dismissed, so it stops proposing them.

Repositories call its compiled `dependabot-fix-workflow.lock.yml` on their own schedule, like [mui-public does daily](./.github/workflows/dependabot-fix.yml), and it runs against the calling repository. Each repository running it needs:

- The four `ANTHROPIC_*` repository variables the Claude workflows use, with the Anthropic federation rule accepting the repository's default-branch OIDC subject.
- The [Code Infra - Auditor](https://github.com/apps/code-infra-auditor) GitHub App installed.
- A `code-infra-auditor` environment, restricted to the default branch, with the App's `CODE_INFRA_AUDITOR_CLIENT_ID` and `CODE_INFRA_AUDITOR_PRIVATE_KEY` as environment secrets. The caller passes both under `secrets:`: a reusable workflow gets no secret the caller doesn't pass.
- An exemption for `refs/heads/code-infra-auditor/*` in any ruleset that restricts branch creation.

After editing the workflow, recompile it with `gh aw compile dependabot-fix-workflow`.

### Ahrefs Site Audit

The reusable [Ahrefs audit workflow](./.github/workflows/ahrefs-audit-workflow.md) fixes what the Ahrefs Site Audit crawl of a repository's site reports. A step before the agent reads the crawl's issues with the Ahrefs API, keeps the pages the repository builds, and re-checks link targets; the agent then fixes the source, typically a shared template. It opens a pull request per Ahrefs issue category (links, redirects and external pages together), and later runs add their fixes to those while they're open.

Repositories call its compiled `ahrefs-audit-workflow.lock.yml` with their Site Audit `project_id` and the site paths they build (`include_paths`, `exclude_paths`). It needs the same setup as the Dependabot fix workflow, plus an `AHREFS_API_KEY` secret in the `code-infra-auditor` environment, which the caller passes along. Each run costs about 550 Ahrefs API units. After editing it, recompile it with `gh aw compile ahrefs-audit-workflow`.

### Docs style review

The reusable [docs style review workflow](./.github/workflows/docs-style-review-workflow.md) reviews the hand-written Markdown a pull request changes, and posts one-click suggestions inline as a comment review, which never blocks merging. It replaces Vale: its prompt compiles in the [writing style guide](./.github/writing-style.md), one section per rule that other agents can be pointed at too, and it also catches what Vale couldn't judge, such as typos, grammar and unclear sentences. A plain job before the agent picks the lines to review: added lines in the `include` files, minus `exclude`, and after a first review only those changed since its commit, without the ones that apply an earlier suggestion. So each line is reviewed once, and a pull request whose suggestions were dealt with gets no more. The agent posts at most `max_comments` (15) suggestions, a ceiling rather than a target. Drafts, and pull requests by authors without write access, bots included, aren't reviewed.

Repositories call its compiled `docs-style-review-workflow.lock.yml` on `pull_request_target` for pull requests to the default branch, so pull requests from forks get reviews too: the pull request's files are read through the API and never checked out. It needs the same setup as the Dependabot fix workflow, except the ruleset exemption, with the Anthropic federation rule also accepting the OIDC subject of `pull_request_target` runs. After editing it, recompile it with `gh aw compile docs-style-review-workflow`.

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
