# Bundle Size Checker

A tool to check and track the bundle size of MUI packages.

## Features

- Measures minified and gzipped bundle sizes of packages and components
- Compares bundle sizes between versions
- Generates markdown reports
- Uploads snapshots to S3 for persistent storage and comparison

## Usage

### CLI

```bash
bundle-size-checker [options]
```

Options:

- `--analyze`: Creates a report for each bundle (using rollup-plugin-visualizer)
- `--debug`: Build with readable output (no name mangling or whitespace collapse, but still tree-shake)
- `--verbose`: Show more detailed information during compilation
- `--output`, `-o`: Path to output the size snapshot JSON file
- `--filter`, `-F`: Filter entry points by glob pattern(s) applied to their IDs
- `--concurrency`, `-c`: Number of workers to use for parallel processing

### Configuration

Create a `bundle-size-checker.config.js` or `bundle-size-checker.config.mjs` file:

```js
import { defineConfig } from '@mui/internal-bundle-size-checker';

export default defineConfig(async () => {
  return {
    entrypoints: [
      // String entries (simple format)
      '@mui/material', // Will bundle `import * as ... from '@mui/material'`
      '@mui/material/Button', // Will bundle `import * as ... from '@mui/material/Button'`
      '@mui/material#Button', // Will bundle `import { Button } from '@mui/material'`

      // Object entries (advanced format)
      {
        id: 'custom-button',
        code: `import Button from '@mui/material/Button'; console.log(Button);`,
      },
      // Object entries with import and importedNames
      {
        id: 'material-button-icons',
        import: '@mui/material',
        importedNames: ['Button', 'IconButton'],
      },
      // Object entry with custom externals
      {
        id: 'custom-externals',
        import: '@mui/material',
        importedNames: ['Button'],
        externals: ['react', 'react-dom', '@emotion/styled'],
      },
      // Object entry that automatically extracts externals from package.json peer dependencies
      {
        id: 'auto-externals',
        import: '@mui/material',
        importedNames: ['Button'],
        // When externals is not specified, peer dependencies will be automatically excluded
      },
      // ...
    ],
    // Optional upload configuration
    upload: {
      project: 'organization/repository',
      branch: 'main', // Optional, defaults to current git branch
      isPullRequest: false, // Optional, defaults to false
    },
  };
});
```

### Debugging bundle size changes

Steps to check bundle sizes locally:

1. Make sure to run `pnpm release:build` as the bunlde size checker operates on build output.
2. You can generate bundle size details using the `--analyze` flag. We added the `pnpm size:why` script for convenience. When you run with this option, the checker generates treeview visualizations in the build folder. You can run this command on multiple checkouts of the repo to compare. You can also use the `-F` option to filter on specific bundles. You can use the `--debug` option to create readable bunldes. This makes analyzing changes easier.
3. Run these steps once on the master branch to create a baseline, rename the `test/bundle-sizes/build` folder, check out the branch you want to debug and repeat. You now have two build folders with bundle data to compare.

### S3 Upload

When the `upload` configuration is provided, the snapshot will be uploaded to S3 after generation.

The snapshot will be uploaded to:

```bash
s3://mui-org-ci/artifacts/{project}/{commit-sha}/size-snapshot.json
```

The following tags will be applied:

- `isPullRequest`: 'yes' or 'no'
- `branch`: The branch name

Required AWS environment variables:

- `AWS_ACCESS_KEY_ID` or `AWS_ACCESS_KEY_ID_ARTIFACTS`
- `AWS_SECRET_ACCESS_KEY` or `AWS_SECRET_ACCESS_KEY_ARTIFACTS`
- `AWS_REGION` or `AWS_REGION_ARTIFACTS` (defaults to 'eu-central-1')

If the upload fails, the CLI will exit with an error code.

## API

The library exports the following functions:

- `defineConfig`: Helper for defining configuration with TypeScript support
- `loadConfig`: Loads configuration from file
- `calculateSizeDiff`: Calculates size differences between snapshots
- `renderMarkdownReport`: Generates markdown reports from size comparisons
- `fetchSnapshot`: Fetches size snapshots from S3
