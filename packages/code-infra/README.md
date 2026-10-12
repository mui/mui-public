# @mui/internal-code-infra

Scripts and configs to be used across MUI repos.

## Documentation

This is stored in the `docs` top-level directory.

[Read in Markdown](../../docs/app/code-infra/page.mdx)

[Read in Browser](https://mui-internal.netlify.app/code-infra)

## Building libraries with tsdown

Run `code-infra build-new --bundle esm cjs` from a package with source files under `src` and `publishConfig.directory` pointing to its output directory. Use `--tsgo` for native TypeScript declaration emission, `--skipTypes` to omit declarations, `--sourceMap` for JavaScript source maps, and `--ignore` or `--copy` for additional source exclusions and copied files.

The build compiles each source file independently and preserves imports between emitted files. Application bundlers can then remove unused namespace members when consuming the published library. Conditional exports, imports, assets, and bin entries are generated from the source manifest. Internal modules and workers are emitted without adding public package exports.

ESM and CommonJS builds run in separate processes because repository Babel configs read format-specific environment settings. Declarations use the existing TypeScript emitter so their module boundaries and extensions match the JavaScript formats. Client/server directive prologues remain attached to their source modules. Native `.mts` and `.cts` declarations are normalized for both output formats, including CommonJS export assignments. Bins and imported assets must live under `src`; paths outside that source tree fail before a manifest can publish missing files.

The downstream-consumer regression test builds the library through the CLI and then bundles its emitted ESM entry with Vite. A direct-source application build does not exercise the [Rolldown namespace export issue](https://github.com/rolldown/rolldown/issues/7874).

## Publishing packages

1. Go to the publish action -

- [Base UI](https://github.com/mui/base-ui/actions/workflows/publish.yml)
- [Core](https://github.com/mui/material-ui/actions/workflows/publish.yml)
- [MUI X](https://github.com/mui/mui-x/actions/workflows/publish.yml)

2. Choose "Run workflow" dropdown

   > - **Branch:** master
   > - **Commit SHA to release from:** the commit that contains the merged release on master. This commit is linked to the GitHub release.
   > - **Run in dry-run mode:** Used for debugging.
   > - **Create GitHub release:** Keep selected if you want a GitHub release to be automatically created from the changelog.
   > - **npm dist tag to publish to** Use to publish legacy or canary versions.

3. Click "Run workflow"
4. Refresh the page to see the newly created workflow, and click it.
5. The next screen shows "@username requested your review to deploy to npm-publish", click "Review deployments" and authorize your workflow run. **Never approve workflow runs you didn't initiaite.**

> [!IMPORTANT]
> Go through the below steps if there is an error that says `The following packages are new and need to be published manually first` in the publish flow.

### Adding and publishing new packages

Whenever new packages are added to the repo (that will get published to npm) or a private package is turned into a public one, follow the below steps before invoking the publish workflow of the previous section.

> [!NOTE]
> This applies to packages published to npm, which is where Trusted Publishing needs the package to already exist. Packages that set `publishConfig.registry` to another registry are skipped by this check and need none of these steps.

1. Go to your repo's code base on your system, then log in to npm using

```bash
npm login
```

2. Once logged-in, open terminal and run:

```bash
pnpm code-infra publish-new-package
```

This command detects the new public packages in the repo and asks for your confirmation before publishing them to the npm registry. Add the `--dryRun` flag to skip the actual publishing.
If publishing fails with npm asking for `otp`, run the command again with 6 digit auth code from your authenticator app where you've added npm; Google Authenticator, Authy or similar:

```bash
pnpm code-infra publish-new-package --otp=123456
```

3. Go to the settings link for each package, e.g., `https://www.npmjs.com/package/<pkg-name>/access`, and setup `Trusted Publisher`.
4. In the `Select your publisher` step in the above link, click on the `GitHub Actions` button to configure GitHub Actions-based trusted publishing.
5. Fill in the details of the repo -
   1. `Organization or user` as `mui`,
   2. `Repository` as per the new package
   3. `Workflow filename*` should be `publish.yml`
   4. `Environment name` should be `npm-publish` or `npm-publish-internal` based on whether the package is user facing package or internal package respectively.
6. In the `Publishing access` section, toggle the recommended option of `Require two-factor authentication and disallow tokens`.
7. Finally, save the changes by clicking on `Update Package Settings` button.

After following these steps, the `Publish` workflow can be invoked again.

## Agent skills

The agent skills previously shipped with this package now live at the repository root. See [Install instructions](../../README.md#agent-skills).
