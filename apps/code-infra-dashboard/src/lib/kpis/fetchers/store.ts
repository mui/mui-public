import { unstable_cache } from 'next/cache';
import type { RowDataPacket } from 'mysql2';
import type { KpiResult } from '../types';
import { getEnvOrError, successResult } from './utils';

// This fetcher requires server-only dependencies (mysql2, ssh2-promise)
// They will be dynamically imported to avoid bundling issues

async function fetchOverdueRatioInternal(): Promise<KpiResult> {
  const password = getEnvOrError('STORE_PRODUCTION_READ_PASSWORD');
  if (typeof password !== 'string') {
    return password;
  }

  const sshKey = getEnvOrError('BASTION_SSH_KEY');
  if (typeof sshKey !== 'string') {
    return sshKey;
  }

  const {
    BASTION_HOST,
    BASTION_USERNAME,
    STORE_PRODUCTION_READ_HOST,
    STORE_PRODUCTION_READ_USERNAME,
    STORE_PRODUCTION_READ_DATABASE,
  } = process.env;

  // Dynamic imports for server-only modules
  const [{ default: SSH2Promise }, mysql] = await Promise.all([
    import('ssh2-promise'),
    import('mysql2/promise'),
  ]);

  const ssh = new SSH2Promise({
    host: BASTION_HOST,
    port: 22,
    username: BASTION_USERNAME,
    privateKey: sshKey.replace(/\\n/g, '\n'),
  });

  const tunnel = await ssh.addTunnel({
    remoteAddr: STORE_PRODUCTION_READ_HOST,
    remotePort: 3306,
  });

  const connection = await mysql.createConnection({
    host: 'localhost',
    port: tunnel.localPort,
    user: STORE_PRODUCTION_READ_USERNAME,
    password,
    database: STORE_PRODUCTION_READ_DATABASE,
  });

  const [rows] = await connection.execute<RowDataPacket[]>(`
SELECT
overdue.total / order_30.total AS ratio
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
        AND post.post_parent = '0'
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
    AND post.post_parent = '0'
) AS order_30
  `);

  await connection.end();
  await ssh.close();

  const ratio = rows[0]?.ratio;
  if (ratio == null) {
    return { value: null, metadata: 'No ratio data available' };
  }

  const percentage = Math.round(ratio * 10000) / 100;

  return successResult(percentage, 'Based on last 30 days invoices');
}

// Wrap with unstable_cache for 1-hour revalidation since this doesn't use fetch()
export const fetchOverdueRatio = unstable_cache(fetchOverdueRatioInternal, ['overdue-ratio'], {
  revalidate: 3600,
});
