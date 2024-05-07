/* eslint-disable import/prefer-default-export */
import { request } from 'graphql-request';

interface PullRequest {
  number: number;
  url: string;
  title: string;
  state: string;
  repository: {
    name: string;
  };
  isDraft: boolean;
  labels: {
    name: string;
  }[];
}

interface QueryResult {
  materialui: {
    pullRequests: {
      nodes: PullRequest[];
    };
  };
  muix: {
    pullRequests: {
      nodes: PullRequest[];
    };
  };
}

export async function queryPRs() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

  const endpoint = 'https://api.github.com/graphql';
  const token = process.env.GITHUB_TOKEN;

  const query = `
      {
        materialui: repository(owner: "mui", name: "material-ui") {
          pullRequests(
            first: 100
            orderBy: {direction: DESC, field: CREATED_AT}
            states: OPEN
          ) {
            nodes {
              number
              url
              title
              state
              repository {
                name
              }
              isDraft
              labels(first: 10) {
                nodes {
                  name
                }
              }
            }
          }
        }
        muix: repository(owner: "mui", name: "mui-x") {
          pullRequests(
            first: 100
            orderBy: {direction: DESC, field: CREATED_AT}
          ) {
            nodes {
              number
              url
              title
              state
              repository {
                name
              }
              isDraft
              labels(first: 10) {
                nodes {
                  name
                }
              }
            }
          }
        }
        basui: repository(owner: "mui", name: "base-ui") {
          pullRequests(
            first: 100
            orderBy: {direction: DESC, field: CREATED_AT}
          ) {
            nodes {
              number
              url
              title
              state
              repository {
                name
              }
              isDraft
              labels(first: 10) {
                nodes {
                  name
                }
              }
            }
          }
        }
        pigmentcss: repository(owner: "mui", name: "pigment-css") {
          pullRequests(
            first: 100
            orderBy: {direction: DESC, field: CREATED_AT}
          ) {
            nodes {
              number
              url
              title
              state
              repository {
                name
              }
              isDraft
              labels(first: 10) {
                nodes {
                  name
                }
              }
            }
          }
        }
      }
            `;

  const response = await request<QueryResult>(
    endpoint,
    query,
    {},
    {
      Authorization: `Bearer ${token}`,
    },
  );

  return response.materialui.pullRequests.nodes
    .concat(response.muix.pullRequests.nodes)
    .map((x) => ({ ...x, repository: x.repository.name }));
}
