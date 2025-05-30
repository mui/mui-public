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

const query1 = `
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
`;

export async function queryLabelsActivity() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

  const endpoint = 'https://api.github.com/graphql';
  const token = process.env.GITHUB_TOKEN;

  const query = `
    {
      materialui: repository(owner: "mui", name: "material-ui") {
        ${query1}
      }
      muix: repository(owner: "mui", name: "mui-x") {
        ${query1}
      }
      baseui: repository(owner: "mui", name: "base-ui") {
        ${query1}
      }
      pigmentcss: repository(owner: "mui", name: "pigment-css") {
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
    ...response.materialui.pullRequests.nodes,
    ...response.materialui.issues.nodes,
    ...response.muix.pullRequests.nodes,
    ...response.muix.issues.nodes,
    ...response.baseui.pullRequests.nodes,
    ...response.baseui.issues.nodes,
    ...response.pigmentcss.pullRequests.nodes,
    ...response.pigmentcss.issues.nodes,
  ].map((issue: Issue) => ({
    ...issue,
    timelineItems: issue.timelineItems.nodes.map((item: LabelTimelineItem) => ({
      label: item.label.name,
      actor: item.actor.login,
    })),
  }));

  return data;
}
