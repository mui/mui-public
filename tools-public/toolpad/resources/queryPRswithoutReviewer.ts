import { createFunction } from '@mui/toolpad/server';
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

export const queryPRswithoutReviewer = createFunction(
  async ({ parameters }) => {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(`Env variable GITHUB_TOKEN not configured`);
    }

    const query1 = `
  nodes {
    number
    url
    title
    isDraft
    createdAt
    repository {
      name
    }
    labels(first: 10) {
      nodes {
        name
      }
    }
    reviews(first: 10) {
      nodes {
        author {
          ... on User {
            name
          }
        }
      }
    }
    reviewRequests(first: 10) {
      nodes {
        requestedReviewer {
          ... on User {
            name
          }
        }
      }
    }
  }
    `;

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
      ${query1}
          }
        }
        muix: repository(owner: "mui", name: "mui-x") {
          pullRequests(
            first: 100
            orderBy: {direction: DESC, field: CREATED_AT}
            states: OPEN
          ) {
      ${query1}
          }
        }
      }
            `;

    const response: any = await request(
      endpoint,
      query,
      {},
      {
        Authorization: `Bearer ${token}`,
      }
    );

    return response.materialui.pullRequests.nodes
      .concat(response.muix.pullRequests.nodes)
      .map((x) => ({ ...x, repository: x.repository.name }));
  }
);
