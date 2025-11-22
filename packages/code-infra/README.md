# @mui/internal-code-infra

Scripts and configs to be used across MUI repos.

## Documentation

This is stored in the `docs` top-level directory.

[Read in Markdown](../../docs/app/code-infra/page.mdx)

[Read in Browser](https://infra.mui.com/code-infra)

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

Whenever news packages are added to the repo (that will get published to npm) or a private package is turned into a public one, follow the below steps before invoking the publish workflow of the previous section.

1. Goto your repo's code base on your system, open terminal and run:

```bash
pnpm code-infra publish-new-package
```

This command detects the new public packages in the repo and asks for your confirmation before publishing them to the npm registry. Add the `--dryRun` flag to skip the actual publishing.

2. Goto the settings link for each packages, ie, https://www.npmjs.com/package/<pkg-name>/access , and setup `Trusted Publisher`.
3. In `Select your publisher` step in the above link, click on the `Github Actions` button to configure Github actions based trusted publishing.
4. Fill in the details of the repo -
   1. `Organization or user` as `mui`,
   2. `Repository` as per the new package
   3. `Workflow filename*` should be `publish.yml`
   4. `Environment name` should be `npm-publish`
5. In the `Publishing access` section, toggle the recommended option of `Require two-factor authentication and disallow tokens`.
6. Finally, save the changes by clicking on `Update Package Settings` button.

After following these steps, the `Publish` workflow can be invoked again.
