/* eslint-disable no-console */

/**
 * @typedef {Object} PluginInputs
 * @property {string} circleciTokenEnvVar - Name of the env var holding the CircleCI API token
 * @property {string} workflowName - Name of the CircleCI workflow to trigger
 * @property {string} deployUrlPipelineParam - Name of the pipeline parameter for the deploy URL
 */

/**
 * @typedef {Object} NetlifyBuildUtils
 * @property {{ failPlugin: (message: string, options?: { error?: Error }) => void }} build
 */

/**
 * @typedef {Object} NetlifyPluginContext
 * @property {PluginInputs} inputs
 * @property {NetlifyBuildUtils} utils
 */

/**
 * Trigger a CircleCI pipeline after a successful Netlify deploy preview.
 *
 * This hook only fires for `deploy-preview` contexts. It extracts the GitHub
 * repo and PR number from Netlify environment variables and calls the CircleCI
 * pipeline API, passing the deploy URL so the pipeline can run E2E tests
 * against the preview.
 *
 * Required Netlify environment variables (set automatically by Netlify):
 *   - `CONTEXT`        – deploy context, e.g. "deploy-preview"
 *   - `REPOSITORY_URL` – full GitHub repository URL
 *   - `REVIEW_ID`      – pull request number (deploy-preview only)
 *   - `DEPLOY_URL`     – URL of the current deploy preview
 *
 * @param {NetlifyPluginContext} context
 */
export async function onSuccess({ inputs, utils }) {
  const context = process.env.CONTEXT;

  if (context !== 'deploy-preview') {
    console.log(`Skipping CircleCI trigger: context is '${context}', not 'deploy-preview'`);
    return;
  }

  const { circleciTokenEnvVar, workflowName, deployUrlPipelineParam } = inputs;

  const token = process.env[circleciTokenEnvVar];
  if (!token) {
    utils.build.failPlugin(
      `CircleCI token not found. Set the '${circleciTokenEnvVar}' environment variable in Netlify.`,
    );
    return;
  }

  const repositoryUrl = process.env.REPOSITORY_URL;
  const reviewId = process.env.REVIEW_ID;
  const deployUrl = process.env.DEPLOY_URL;

  if (!repositoryUrl || !reviewId || !deployUrl) {
    utils.build.failPlugin(
      `Missing required Netlify environment variables. Got: REPOSITORY_URL=${repositoryUrl}, REVIEW_ID=${reviewId}, DEPLOY_URL=${deployUrl}`,
    );
    return;
  }

  const repoMatch = repositoryUrl.match(/github\.com\/([^/]+\/[^/?#]+?)(?:\.git)?(?:[/?#]|$)/);
  if (!repoMatch) {
    utils.build.failPlugin(
      `Could not extract GitHub owner/repo from REPOSITORY_URL: ${repositoryUrl}`,
    );
    return;
  }
  const repo = repoMatch[1];

  console.log(`Triggering CircleCI pipeline for ${repo} PR #${reviewId}`);
  console.log(`Deploy URL: ${deployUrl}`);

  const response = await fetch(`https://circleci.com/api/v2/project/gh/${repo}/pipeline`, {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
      // https://circleci.com/docs/2.0/api-developers-guide/
      'Circle-Token': token,
    },
    body: JSON.stringify({
      // For a PR branch, /head is required:
      // https://support.circleci.com/hc/en-us/articles/360049841151
      branch: `pull/${reviewId}/head`,
      parameters: {
        workflow: workflowName,
        [deployUrlPipelineParam]: deployUrl,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    utils.build.failPlugin(`CircleCI API request failed (${response.status}): ${body}`);
    return;
  }

  /** @type {{ id: string }} */
  const result = /** @type {{ id: string }} */ (await response.json());
  console.log(`CircleCI pipeline triggered successfully (id: ${result.id})`);
}
