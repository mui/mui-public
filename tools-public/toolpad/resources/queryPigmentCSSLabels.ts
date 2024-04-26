/* eslint-disable import/prefer-default-export */
import { request } from 'graphql-request';

interface LabelTimelineItem {
  label: {
    name: string;
  };
  actor: {
    login: string;
  };
}

interface Issue {
  number: number;
  url: string;
  title: string;
  timelineItems: {
    nodes: LabelTimelineItem[];
  };
}

export async function queryPigmentCSSLabels() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

  const endpoint = 'https://api.github.com/graphql';
  const token = process.env.GITHUB_TOKEN;

  const query = `
    {
      repository(owner: "mui", name: "Pigment-CSS") {
        pullRequests(first: 50, orderBy: {direction: DESC, field: CREATED_AT}) {
          nodes {
            number
            url
            title
            timelineItems(itemTypes: LABELED_EVENT, first: 100) {
              nodes {
                ... on LabeledEvent {
                  label {
                    name
                  }
                  actor {
                    login
                  }
                }
              }
            }
          }
        }
        issues(first: 50, orderBy: { direction: DESC, field: CREATED_AT }) {
          nodes {
            number
            url
            title
            timelineItems(itemTypes: LABELED_EVENT, first: 100) {
              nodes {
                ... on LabeledEvent {
                  label {
                    name
                  }
                  actor {
                    login
                  }
                }
              }
            }
          }
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
    },
  );

  const pullRequests = response.repository.pullRequests.nodes;
  const issues = response.repository.issues.nodes;

  const data = [...pullRequests, ...issues].map((issue: Issue) => ({
    ...issue,
    timelineItems: issue.timelineItems.nodes.map((item: LabelTimelineItem) => ({
      label: item.label.name,
      actor: item.actor.login,
    })),
  }));

  return data;
}
