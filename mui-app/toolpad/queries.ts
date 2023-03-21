import { createQuery } from "@mui/toolpad-core";

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

/* TO BE REMOVED

export const getContributorStats = createQuery(
  async function getContributorStats({ parameters }) {
    const openQuery = `
with pr_open as (
  SELECT
    ge.actor_id,
    ge.pr_or_issue_id,
    ANY_VALUE(ge.actor_login) AS actor_login,
    CONCAT(YEAR(ge.created_at), '-', MONTH(ge.created_at)) as month
  FROM
    github_events ge
  WHERE
    ge.repo_id = 23083156
    AND ge.type = 'PullRequestEvent'
    AND ge.action = 'opened'
    AND ge.created_at >= '2022-11-01'
    AND ge.actor_login NOT LIKE '%bot'
    AND ge.actor_login NOT LIKE '%[bot]'
), pr_open_group as (
  SELECT
    ge.actor_id,
    ge.month,
    ge.actor_login,
    COUNT(DISTINCT ge.pr_or_issue_id) AS prs
  FROM pr_open ge
  GROUP BY
    ge.actor_id, ge.month, ge.actor_login
  ORDER BY
    ge.month desc,
    prs desc
)
SELECT * FROM pr_open_group ge WHERE ge.prs > 1;
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



export const PRsOpenQuery = createQuery(
  async function PRsOpenQuery ({ parameters }) {
    const openQuery = `
    SELECT
    ge.actor_id, year(ge.created_at) as year, month(ge.created_at) as month, 
    ANY_VALUE(ge.actor_login) AS actor_login,
    COUNT(DISTINCT ge.pr_or_issue_id) AS prs_created
  FROM
    github_events ge
  WHERE
    ge.repo_id = 23083156
    AND ge.type = 'PullRequestEvent'
    AND ge.action = 'opened'
    AND ge.created_at >= '2023-01-01'
   -- AND ge.created_at < '2023-12-01'
    AND ge.actor_login NOT LIKE '%bot'
    AND ge.actor_login NOT LIKE '%[bot]'
  GROUP BY
    ge.actor_id, year, month
  ORDER BY
    year desc, month desc, prs_created desc;
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


export const PRsReviewed = createQuery(
  async function PRsReviewed ({ parameters }) {
    const openQuery = `
    SELECT
  ge.actor_id, year(ge.created_at) as year, month(ge.created_at) as month,
  ANY_VALUE(ge.actor_login) AS actor_login,
  COUNT(DISTINCT ge.pr_or_issue_id) AS prs_reviewed
FROM
  github_events ge
  -- join with all pull request created by someone outside of the Core team
  JOIN (
    SELECT
      *
    from
      github_events ge2
    where
      ge2.repo_id = 23083156
      AND ge2.type like "PullRequestEvent"
      AND ge2.action = "opened"
      AND ge2.actor_login NOT LIKE 'mnajdova'
      AND ge2.actor_login NOT LIKE 'michaldudak'
      AND ge2.actor_login NOT LIKE 'siriwatknp'
      AND ge2.actor_login NOT LIKE 'hbjORbj'
      AND ge2.actor_login NOT LIKE 'oliviertassinari'
      AND ge2.actor_login NOT LIKE 'mj12albert'
  ) as pr_creators ON ge.pr_or_issue_id = pr_creators.pr_or_issue_id
  AND ge.actor_id <> pr_creators.actor_id
WHERE
  ge.repo_id = 23083156
  AND ge.type = 'PullRequestReviewEvent'
  AND ge.action = 'created'
  AND ge.created_at >= '2023-01-01'
  -- AND ge.created_at < '2023-02-01'
  AND ge.actor_login NOT LIKE '%bot'
  AND ge.actor_login NOT LIKE '%[bot]'
GROUP BY
  ge.actor_id, year, month
ORDER BY
  year desc, month desc, prs_reviewed desc;
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
*/

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