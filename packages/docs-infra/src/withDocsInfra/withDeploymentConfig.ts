import type { NextConfig } from 'next';
import pkgJson from 'next/package.json' with { type: 'json' };
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import { dirname, join } from 'node:path';

// Read Next.js version to handle version-specific config
const nextMajorVersion = parseInt(pkgJson.version.split('.')[0], 10);

/**
 * See the docs of the Netlify environment variables:
 * https://docs.netlify.com/configure-builds/environment-variables/#build-metadata.
 *
 * A few comments:
 * - process.env.CONTEXT === 'production' means that the branch in Netlify was configured as production.
 *   For example, the `master` branch of the Core team is considered a `production` build on Netlify based
 *   on https://app.netlify.com/sites/material-ui/settings/deploys#branches.
 * - Each team has different site https://app.netlify.com/teams/mui/sites.
 *   The following logic must be compatible with all of them.
 */
let DEPLOY_ENV = 'development';

// Same as process.env.PULL_REQUEST_ID
if (process.env.CONTEXT === 'deploy-preview') {
  DEPLOY_ENV = 'pull-request';
}

if (process.env.CONTEXT === 'production' || process.env.CONTEXT === 'branch-deploy') {
  DEPLOY_ENV = 'production';
}

// The 'master' and 'next' branches are NEVER a production environment. We use these branches for staging.
if (
  (process.env.CONTEXT === 'production' || process.env.CONTEXT === 'branch-deploy') &&
  (process.env.HEAD === 'master' || process.env.HEAD === 'next')
) {
  DEPLOY_ENV = 'staging';
}
/**
 * ====================================================================================
 */

process.env.DEPLOY_ENV = DEPLOY_ENV;

const SHOW_PRIVATE_PAGES = String(
  process.env.DEPLOY_ENV !== 'production' && process.env.DEPLOY_ENV !== 'staging',
);
process.env.SHOW_PRIVATE_PAGES = SHOW_PRIVATE_PAGES;

/**
 * URL prefix pointing at the source tree of the currently-deployed commit
 * (e.g. `https://github.com/owner/repo/tree/<branch>/`). Used by demo
 * factories to rewrite local `file://` URLs gathered at build time into
 * hosted Git URLs.
 *
 * Resolution order:
 * - Repository URL: `process.env.REPOSITORY_URL` (set by Netlify), falling
 *   back to the `repository` field of the nearest ancestor `package.json`.
 * - Branch: `process.env.BRANCH` (set by Netlify), falling back to
 *   `git rev-parse --abbrev-ref HEAD`.
 *
 * Resolves to an empty string when neither source yields a value.
 */
const repoRootDir = findRepoRootDir();
const SOURCE_CODE_ROOT_PATH = repoRootDir ?? '';
const SOURCE_CODE_ROOT_URL = resolveSourceCodeRootUrl(repoRootDir);
process.env.SOURCE_CODE_ROOT_PATH = SOURCE_CODE_ROOT_PATH;
process.env.SOURCE_CODE_ROOT_URL = SOURCE_CODE_ROOT_URL;

function resolveSourceCodeRootUrl(rootDir: string | undefined): string {
  const repositoryUrl =
    process.env.REPOSITORY_URL ?? (rootDir ? readRepositoryUrlFromPackageJson(rootDir) : undefined);
  const branch = process.env.BRANCH ?? readBranchFromGit();
  if (!repositoryUrl || !branch) {
    return '';
  }
  const repoBase = repositoryUrl
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  return `${repoBase}/tree/${branch}/`;
}

function findRepoRootDir(): string | undefined {
  // Prefer git: `git rev-parse --show-toplevel` returns the absolute path to
  // the repository root regardless of which subdirectory we run from.
  try {
    const top = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (top) {
      return top;
    }
  } catch {
    // git unavailable or not a repo, fall through to filesystem walk.
  }

  // Fallback: walk up looking for the root `package.json` (one with a
  // `repository` field, indicating it's the project root rather than a
  // workspace package).
  let dir = process.cwd();
  while (true) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        repository?: unknown;
      };
      if (pkg.repository) {
        return dir;
      }
    } catch {
      // package.json missing or unreadable at this level, keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function readRepositoryUrlFromPackageJson(rootDir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
      repository?: string | { url?: string };
    };
    const repo = pkg.repository;
    return typeof repo === 'string' ? repo : repo?.url;
  } catch {
    return undefined;
  }
}

function readBranchFromGit(): string | undefined {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch && branch !== 'HEAD' ? branch : undefined;
  } catch {
    return undefined;
  }
}

export function withDeploymentConfig<T extends NextConfig>(nextConfig: T): T {
  return {
    trailingSlash: true,
    reactStrictMode: true,
    productionBrowserSourceMaps: true,
    ...nextConfig,
    env: {
      // production | staging | pull-request | development
      DEPLOY_ENV,
      SHOW_PRIVATE_PAGES,
      ...nextConfig.env,
      // https://docs.netlify.com/configure-builds/environment-variables/#git-metadata
      // reference ID (also known as "SHA" or "hash") of the commit we're building.
      COMMIT_REF: process.env.COMMIT_REF,
      // ID of the PR and the Deploy Preview it generated (for example, 1211)
      PULL_REQUEST_ID: process.env.REVIEW_ID,
      // This can be set manually in the .env to see the ads in dev mode.
      ENABLE_AD_IN_DEV_MODE: process.env.ENABLE_AD_IN_DEV_MODE,
      // URL representing the unique URL for an individual deploy, e.g.
      // https://5b243e66dd6a547b4fee73ae--petsof.netlify.app
      SITE_DEPLOY_URL: process.env.DEPLOY_URL,
      // Name of the site, its Netlify subdomain; for example, material-ui-docs
      SITE_NAME: process.env.SITE_NAME,
      // URL for the linked Git repository.
      REPOSITORY_URL: process.env.REPOSITORY_URL,
      // Reference to check out after fetching changes from the Git repository.
      // Can be useful for split testing.
      BRANCH: process.env.BRANCH,
      // URL prefix pointing at the source tree of the currently-deployed
      // commit (e.g. `https://github.com/owner/repo/tree/<branch>/`). Derived
      // from REPOSITORY_URL/BRANCH with package.json/git fallbacks.
      SOURCE_CODE_ROOT_URL,
      // Absolute filesystem path of the repository root, used to translate
      // `import.meta.url` file URLs into paths relative to the repo root
      // before applying SOURCE_CODE_ROOT_URL.
      SOURCE_CODE_ROOT_PATH,
      // For template images
      TEMPLATE_IMAGE_URL: '',
    },
    experimental: {
      scrollRestoration: true,
      workerThreads: false,
      ...(process.env.CI
        ? {
            cpus: process.env.NEXT_PARALLELISM
              ? parseInt(process.env.NEXT_PARALLELISM, 10)
              : os.availableParallelism(),
          }
        : {}),
      ...nextConfig.experimental,
    },
    ...(nextMajorVersion < 16
      ? {
          // TODO remove this once all our projects are on Next.js 16+
          // https://nextjs.org/blog/next-16
          eslint: {
            ignoreDuringBuilds: true,
            ...(nextConfig as any).eslint,
          },
        }
      : {}),
    typescript: {
      // Motivated by https://github.com/vercel/next.js/issues/7687
      ignoreBuildErrors: true,
      ...nextConfig.typescript,
    },
  };
}
