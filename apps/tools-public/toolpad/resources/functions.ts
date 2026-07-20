import { request } from 'graphql-request';
import mysql from 'mysql2/promise';
import SSH2Promise from 'ssh2-promise';

export async function queryCommitStatuses(repository: string) {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const endpoint = 'https://api.github.com/graphql';
  const token = process.env.GITHUB_TOKEN;

  const query = `
query getCommitStatuses($repository: String!, $since: GitTimestamp!) {
  repository(owner: "mui", name: $repository) {
    defaultBranchRef {
      id
      name
      target {
        ... on Commit {
          history(since: $since) {
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
    {
      repository,
      since: since.toISOString(),
    },
    {
      Authorization: `Bearer ${token}`,
    },
  );

  return response;
}

export async function getRatio() {
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
    privateKey: process.env.BASTION_SSH_KEY.replace(/\\n/g, '\n'),
  });

  const tunnel = await ssh.addTunnel({
    remoteAddr: process.env.STORE_PRODUCTION_READ_HOST,
    remotePort: 3306,
  });

  const connection = await mysql.createConnection({
    host: 'localhost',
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
    LEFT JOIN wp3u_postmeta postmeta2 ON postmeta2.post_id = post.id
    AND postmeta2.meta_key = '_order_tax'
  WHERE
    post.post_status = 'wc-completed'
    AND post.post_type = 'shop_order'
    AND post.post_date >= date_sub(now(), interval 30 day)
    AND post.post_parent = '0' -- ignore orders that are sub-orders
) AS order_30
  `);

  await connection.end();
  await ssh.close();

  return ratio[0];
}
