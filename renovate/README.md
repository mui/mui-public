# Renovate

The `packageRules` is a hard to understand beast. In this READMNE we'll document all of our findings on how to do effective grouping of packages.

## How does it work

a package rule entry does two things:

- it matches a dependency (all `match*` properties)
- it defines configuration for the match (all other properties)

For each package in your dependencies, it is matched against the package rules. All the configured rules are iterated in order. If a rule matches the specific dependency then the configuration in the rule is applied to the package.

It's important to note that a rule matches a dependency if ALL of it's `match*` rules match the dependency.

Example: if you want to group all packages of the `monorepo:vitest`, `group:vite` presets and packages matching the name `vite-*`, you can't do this in the single rule:

```json
{
  "extends": ["monorepo:vitest", "group:vite"],
  "matchPackageNAmes": ["vite-*"],
  "groupName": "vite-related"
}
```

Matching works essentially by combining all the match rules as if `Object.assign({}, monorepoVitest, groupVite, { matchPackageNames: ["vite-*"] })`. Then whatever the end result is, the package has to match ALL `match*` properties to get the `groupName` applied. Instead you need to

```json
{
  "extends": ["monorepo:vitest"],
  "groupName": "vite-related"
},
{
  "extends": ["group:vite"],
  "groupName": "vite-related"
},
{
  "matchPackageNAmes": ["vite-*"],
  "groupName": "vite-related"
}
```

The `groupName` is just a configuration value for a dependency. Just like any other configuration value, after all rules have been applied, whatever a dependency ends up with as configuration, that's what's being applied.

**Note:** So to be clear `groupName` is a setting, not a matcher. in order to apply a setting to all packages in the `vite-related` group, you can't so it by adding:

```json
{
  "groupName": "vite-related",
  "autoMerge": true
}
```

This will do nothing, instead you will have to set it on each rule:

```json
{
  "extends": ["monorepo:vitest"],
  "groupName": "vite-related",
  "autoMerge": true
},
{
  "extends": ["group:vite"],
  "groupName": "vite-related",
  "autoMerge": true
},
{
  "matchPackageNAmes": ["vite-*"],
  "groupName": "vite-related",
  "autoMerge": true
}
```

## Presets

- `base.json` — catch-all groups, extended first so that every later `groupName` wins over it.
- `default.json` — the configuration every MUI repository extends.
- `experimental.json` — extends `default.json` and is extended by mui-public only, so a grouping
  change can be observed for a few cycles before it reaches the other repositories. It is meant to
  be folded into `default.json` and deleted, not to live on.

Presets are resolved from GitHub rather than from disk, so a change only takes effect once it is
on `master` and there is nothing to roll back to. To try a preset out from a pull request, point
the consuming `renovate.json` at the branch for the duration of the review:

```json
{ "extends": ["github>mui/mui-public//renovate/experimental#my-branch"] }
```

## Grouping by update type

Every family group — the ones written here, and the ones `config:recommended` brings in through
`group:monorepos` and `group:recommended` — matches on package identity only, not on update type.
One family therefore produces a PR for its patches, another for its minors, and another for its
majors.

Because `groupName` is a setting and the last matching rule wins, a rule placed _after_ those that
claims every non-major update collapses all of them into one PR, and leaves each family group
applying to majors alone. That is the whole mechanism behind `experimental.json`; no per-family
rule is needed to group majors, because the family groups already exist.
