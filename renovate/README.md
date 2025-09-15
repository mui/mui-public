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
