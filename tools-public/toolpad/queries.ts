import { createQuery } from "@mui/toolpad-core";
import { request } from "graphql-request";

export const getRepositoryDetails = createQuery(
  async function getRepositoryDetails({ parameters }) {
    const res = await fetch(
      `https://api.ossinsight.io/gh/repo/${parameters.slug}`,
      {
        method: "GET",
      }
    );
            if (res.status !== 200) {
      throw new Error(
        `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`
      );
    }
    return res.json();
  },
  {
    parameters: {
      slug: {
        typeDef: { type: "string" },
      },
    },
  }
);


export const PRsOpenandReviewedQuery = createQuery(
  async function PRsOpenandReviewedQuery ({ parameters }) {
    const openQuery = `
    with pr_opened as (
      SELECT
          number,
          date_format(created_at, '%Y-%m-01') AS event_month,
          actor_login
        FROM
          github_events ge
        WHERE
          type = 'PullRequestEvent'
          AND action = 'opened'
          AND repo_id = 23083156
          AND ge.created_at >= '2021-12-01'
          -- AND ge.created_at < '2023-01-01'
          AND actor_login NOT LIKE '%bot'
          AND actor_login NOT LIKE '%[bot]'
          AND ge.actor_login NOT LIKE 'mnajdova'
          AND ge.actor_login NOT LIKE 'michaldudak'
          AND ge.actor_login NOT LIKE 'siriwatknp'
          AND ge.actor_login NOT LIKE 'hbjORbj'
          AND ge.actor_login NOT LIKE 'oliviertassinari'
          AND ge.actor_login NOT LIKE 'mj12albert'
      ), pr_reviewed as (
      SELECT 
          number,
          date_format(created_at, '%Y-%m-01') AS event_month,
          actor_login
      FROM
          github_events ge
      WHERE
            ge.repo_id = 23083156
        AND ge.type = 'PullRequestReviewEvent'
        AND ge.action = 'created'
        AND ge.created_at >= '2021-12-01'
        -- AND ge.created_at < '2023-01-01'
        AND ge.actor_login NOT LIKE '%bot'
        AND ge.actor_login NOT LIKE '%[bot]'
        AND ge.actor_login IN
        ('mnajdova','michaldudak','siriwatknp','hbjORbj','oliviertassinari','mj12albert')
      ), new_table as (
       SELECT
          pr_reviewed.event_month,
          pr_reviewed.number,
          pr_opened.actor_login as open_by,
          pr_reviewed.actor_login as reviewed_by
        FROM
          pr_reviewed
          JOIN pr_opened on pr_opened.number = pr_reviewed.number)
      , pr_open_by_core as (
      SELECT
          number,
          date_format(created_at, '%Y-%m-01') AS event_month,
          actor_login
        FROM
          github_events ge
        WHERE
          type = 'PullRequestEvent'
          AND action = 'opened'
          AND repo_id = 23083156
          AND ge.created_at >= '2021-12-01'
          -- AND ge.created_at < '2023-01-01'
          AND actor_login NOT LIKE '%bot'
          AND actor_login NOT LIKE '%[bot]'
          AND ge.actor_login IN
        ('mnajdova','michaldudak','siriwatknp','hbjORbj','oliviertassinari','mj12albert')
      ), final_table AS (
      SELECT n.event_month, n.reviewed_by, COUNT(DISTINCT n.number) as reviewed, COUNT(DISTINCT p.number) as opened
      FROM new_table n
      JOIN pr_open_by_core p ON p.actor_login=n.reviewed_by 
              AND p.event_month=n.event_month
      GROUP BY
      event_month,reviewed_by
      ORDER BY event_month ASC )
      
      SELECT * FROM final_table
    
  `;
  const res = await fetch("https://api.ossinsight.io/q/playground", {
    "headers": {
      "content-type": "application/json",
    },
    "body": JSON.stringify({sql: openQuery,"type":"repo","id":"23083156"}),
    "method": "POST"
  });
  if (res.status !== 200) {
    throw new Error(
      `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`
    );
  }
  const data = await res.json();
  return data.data;
},
{
  parameters: {
    // orderIds: {
    //   typeDef: { type: "string" },
    // },
  },
}
);


export const queryCommitStatuses = createQuery(
async function queryCommitStatuses({ parameters }) {

if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
}

const since = new Date();
since.setDate(since.getDate() - 7);

const endpoint = 'https://api.github.com/graphql';
const token = process.env.GITHUB_TOKEN;

const query = `
{
  repository(owner: "mui", name: "${parameters.repository}") {
  	defaultBranchRef {
      id
      name
      target {
        ... on Commit {
          history(since: "${since.toISOString()}") {
            nodes {
              messageHeadline
              committedDate
              status {
                state
              }
            }
          }
        }
      }
    }
  }
}  
`;

const response =  request(endpoint, query, null, {
  Authorization: `Bearer ${token}`,
})

return response;

},
{
  parameters: {
      repository: {
      typeDef: { type: "string" },
     },
  },
})
