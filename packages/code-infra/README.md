# @mui/internal-code-infra

Scripts and configs to be used across MUI repos.

## Documentation

This is stored in the `docs` top-level directory.

[Read in Markdown](../../docs/app/code-infra/page.mdx)

[Read in Browser](https://mui-internal.netlify.app/code-infra)

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
> This applies to packages published to npm, which is where Trusted Publishing needs the package to already exist. Packages that set `publishConfig.registry` to another registry are skipped by this check and need none of these steps — see [Publishing to the self-hosted registry](#publishing-to-the-self-hosted-registry).

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

### Publishing to the self-hosted registry

Some packages are published to `https://npm.mui.com`, a self-hosted registry that serves the `@base-ui-private` scope to a small set of external consumers. It has no Trusted Publishing and no provenance; publishing is authenticated with a `ci-publisher` credential.

Point each package at it in its `package.json`:

```json
{
  "publishConfig": {
    "registry": "https://npm.mui.com/"
  }
}
```

Leave `access` out — the registry derives permissions from its own config, so the field would only mislead.

Then give the publish workflow the credential. `publish-prepare` takes it from there, routing the scope and authenticating it for the rest of the job:

```yaml
- name: Prepare for publishing
  uses: ./.github/actions/publish-prepare
  with:
    mui-npm-auth: ${{ secrets.MUI_NPM_AUTH }}
```

That is the whole setup — no `.npmrc` in the repo. Two things are worth knowing about why:

- The credential **cannot** live in a committed `.npmrc`. pnpm refuses to expand environment variables in auth values read from a project-level file, on the grounds that the file is committed and could leak the secret to an attacker-controlled registry. A `//npm.mui.com/:_auth=${VAR}` line there is dropped with a warning and the publish goes out unauthenticated. `publish-prepare` writes to the npm user config instead, which pnpm trusts.
- The `@base-ui-private:registry=` line matters even though every package sets `publishConfig.registry`. pnpm's "is this version already published?" pre-check resolves through the registries it knows from npmrc, not through `publishConfig`. Without it, the first publish succeeds and every re-run fails with a 409.

Publishing to this registry does not need `id-token: write`; OIDC is npm-only and just adds a failed token exchange per package.
