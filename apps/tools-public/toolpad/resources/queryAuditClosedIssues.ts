import { request } from 'graphql-request';

interface CloseTimelineItem {
  actor: {
    login: string;
  };
  createdAt: string;
}

interface Issue {
  number: number;
  url: string;
  title: string;
  timelineItems: {
    nodes: CloseTimelineItem[];
  };
}

const query1 = `
issues(first: 100, orderBy: { direction: DESC, field: UPDATED_AT }) {
  nodes {
    number
    url
    title
    timelineItems(itemTypes: CLOSED_EVENT, last: 10) {
      nodes {
        ... on ClosedEvent {
          actor {
            login
          }
          createdAt
        }
      }
    }
  }
}
`;

export async function queryAuditClosedIssues(githubUser?: string) {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

  const endpoint = 'https://api.github.com/graphql';
  const token = process.env.GITHUB_TOKEN;

  const query = `
    {
      base_ui: repository(owner: "mui", name: "base-ui") {
        ${query1}
      }
      mui_public: repository(owner: "mui", name: "mui-public") {
        ${query1}
      }
      material_ui: repository(owner: "mui", name: "material-ui") {
        ${query1}
      }
      mui_x: repository(owner: "mui", name: "mui-x") {
        ${query1}
      }
      pigment_css: repository(owner: "mui", name: "pigment-css") {
        ${query1}
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

  const data = [
    ...response.base_ui.issues.nodes,
    ...response.mui_public.issues.nodes,
    ...response.material_ui.issues.nodes,
    ...response.mui_x.issues.nodes,
    ...response.pigment_css.issues.nodes,
  ]
    .map((issue: Issue) => ({
      ...issue,
      timelineItems: issue.timelineItems.nodes
        .map((item: CloseTimelineItem) => {
          return {
            createdAt: item.createdAt,
            // An actor can delete his account.
            actor: item.actor?.login,
          };
        })
        .filter((item) => !githubUser || item.actor === githubUser),
    }))
    .filter((issue) => issue.timelineItems.length > 0)
    .sort((a, b) => {
      return a.timelineItems[0].createdAt < b.timelineItems[0].createdAt ? 1 : -1;
    });

  return data;
}
