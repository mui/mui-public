import { createFunction } from "@mui/toolpad/server";
import { request } from "graphql-request";
import mysql from "mysql2/promise";
import SSH2Promise from "ssh2-promise";

export const getRepositoryDetails = createFunction(
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

export const PRsOpenandReviewedQuery = createFunction(
  async function PRsOpenandReviewedQuery({ parameters }) {
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
  AND ge.actor_login NOT LIKE '%bot'
  AND ge.actor_login NOT LIKE '%[bot]'
  AND ge.actor_login IN ('mnajdova','michaldudak','siriwatknp','hbjORbj','oliviertassinari','mj12albert')
), pr_reviewed_with_open_by as (
  SELECT
    pr_reviewed.event_month,
    pr_reviewed.number,
    pr_reviewed.actor_login as reviewed_by,
    pr_opened.actor_login as open_by
  FROM pr_reviewed
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
  SELECT
    n.event_month,
    n.reviewed_by,
    COUNT(DISTINCT n.number) as reviewed,
    COUNT(DISTINCT p.number) as opened
  FROM pr_reviewed_with_open_by n
  JOIN
    pr_open_by_core p ON p.actor_login = n.reviewed_by AND p.event_month = n.event_month
  GROUP BY
    event_month,
    reviewed_by
  ORDER BY
    event_month DESC
)

SELECT * FROM final_table
  `;
    const res = await fetch("https://api.ossinsight.io/q/playground", {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql: openQuery, type: "repo", id: "23083156" }),
      method: "POST",
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

export const queryCommitStatuses = createFunction(
  async function queryCommitStatuses({ parameters }) {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(`Env variable GITHUB_TOKEN not configured`);
    }

    const since = new Date();
    since.setDate(since.getDate() - 7);

    const endpoint = "https://api.github.com/graphql";
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

    const response = request(
      endpoint,
      query,
      {},
      {
        Authorization: `Bearer ${token}`,
      }
    );

    return response;
  },
  {
    parameters: {
      repository: {
        typeDef: { type: "string" },
      },
    },
  }
);

export const getRatio = createFunction(async function getRatio({ parameters }) {
  if (!process.env.STORE_PRODUCTION_READ_PASSWORD) {
    throw new Error(`Env variable STORE_PRODUCTION_READ_PASSWORD not configured`);
  }
  if (!process.env.BASTION_SSH_KEY) {
    throw new Error(`Env variable BASTION_SSH_KEY not configured`);
  }

  const ssh = new SSH2Promise({
    host: process.env.BASTION_HOST,
    port: 22,
    username: process.env.BASTION_USERNAME,
    privateKey: process.env.BASTION_SSH_KEY.replace(/\\n/g, "\n"),
  });

  const tunnel = await ssh.addTunnel({
    remoteAddr: process.env.STORE_PRODUCTION_READ_HOST,
    remotePort: 3306,
  });

  const connection = await mysql.createConnection({
    host: "localhost",
    port: tunnel.localPort,
    user: process.env.STORE_PRODUCTION_READ_USERNAME,
    password: process.env.STORE_PRODUCTION_READ_PASSWORD,
    database: process.env.STORE_PRODUCTION_READ_DATABASE,
  });

  const [ratio] = await connection.execute(`
SELECT
overdue.total / order_30.total AS ratio
-- overdue.total,
-- order_30.total
FROM
(
  SELECT
    sum(post.total) AS total
  FROM
    (
      SELECT
        postmeta1.meta_value - postmeta2.meta_value AS total,
        CASE
          WHEN postmeta3.meta_value IS NOT NULL THEN postmeta3.meta_value
          ELSE 30
        END AS payment_term,
        from_unixtime(
          postmeta4.meta_value + (
            CASE
              WHEN postmeta3.meta_value IS NOT NULL THEN postmeta3.meta_value
              ELSE 30
            END
          ) * 3600 * 24
        ) AS invoice_due,
        postmeta4.meta_value AS invoice_date,
        postmeta5.meta_value AS billing_country,
        post.id
      FROM
        wp3u_posts post
        LEFT JOIN wp3u_postmeta postmeta1 ON postmeta1.post_id = post.id
        AND postmeta1.meta_key = '_order_total'
        LEFT JOIN wp3u_postmeta postmeta2 ON postmeta2.post_id = post.id
        AND postmeta2.meta_key = '_order_tax'
        LEFT JOIN wp3u_postmeta postmeta3 ON postmeta3.post_id = post.id
        AND postmeta3.meta_key = 'payment_term'
        LEFT JOIN wp3u_postmeta postmeta4 ON postmeta4.post_id = post.id
        AND postmeta4.meta_key = '_wcpdf_invoice_date'
        LEFT JOIN wp3u_postmeta postmeta5 ON postmeta5.post_id = post.id
        AND postmeta5.meta_key = '_billing_country'
      WHERE
        post.post_status = 'wc-processing'
        AND post.post_type = 'shop_order'
        AND post.post_parent = '0' -- ignore orders that are sub-orders
      order by
        post.post_date desc
    ) AS post
  WHERE
    DATEDIFF(now(), post.invoice_due) > 0
) AS overdue,
(
  SELECT
    sum(postmeta1.meta_value - postmeta2.meta_value) AS total
  FROM
    wp3u_posts post
    LEFT JOIN wp3u_postmeta postmeta1 ON postmeta1.post_id = post.id
    AND postmeta1.meta_key = '_order_total'
    LEFT JOIN wp3u_postmeta postmeta2 ON postmeta2.post_id = pgost.id
    AND postmeta2.meta_key = '_order_tax'
  WHERE
    post.post_status = 'wc-completed'
    AND post.post_type = 'shop_order'
    AND post.post_date >= date_sub(now(), interval 30 day)
    AND post.post_parent = '0' -- ignore orders that are sub-orders
) AS order_30
  `);
  return ratio[0];
});

export * from "./bundleSizeQueries";
export * from "./queryMaterialUILabels";
export * from "./queryMUIXLabels";
export * from "./queryPRs";
export * from "./queryPRs2";
export * from "./queryGender";
export * from "./queryHeadlessLibrariesDownloads";
export * from "./queryJoyUIMonthlyDownloads";
export * from "./queryPrioritySupport";
