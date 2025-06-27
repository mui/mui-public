import { rawRequest } from 'graphql-request';

export async function queryGitHubSearchAPI(queryInput = '', type = 'ISSUE') {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

  const endpoint = 'https://api.github.com/graphql';
  const token = process.env.GITHUB_TOKEN;

  // https://docs.github.com/en/graphql/reference/queries#search
  // 5,000 requests/hr rate limit https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api#primary-rate-limit
  // vs. https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28#rate-limit
  // with 30 requests/minutes or 1,800 request/hr.
  const query = `
{
  search(query: "${queryInput}", type: ${type}, first: 100) {
    issueCount
    nodes {
      ... on PullRequest {
        number
        state
        labels(first: 10, orderBy: { direction: DESC, field: CREATED_AT }) {
          nodes {
            name
          }
        }
      }
    }
  }
}
            `;

  const response = await rawRequest<any>(
    endpoint,
    query,
    {},
    {
      Authorization: `Bearer ${token}`,
    },
  );

  return response.data.search;
}
