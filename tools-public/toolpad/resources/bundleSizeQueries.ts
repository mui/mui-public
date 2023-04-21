// Toolpad queries:

import axios from "axios";
import { createFunction } from "@mui/toolpad/server";

function getMainBundleLabel(bundleId: string): string {
  if (
    bundleId === "packages/material-ui/build/umd/material-ui.production.min.js"
  ) {
    return "@mui/material[umd]";
  }
  if (bundleId === "@material-ui/core/Textarea") {
    return "TextareaAutosize";
  }
  if (bundleId === "docs.main") {
    return "docs:/_app";
  }
  if (bundleId === "docs.landing") {
    return "docs:/";
  }
  return (
    bundleId
      // package renames
      .replace(/^@material-ui\/core$/, "@mui/material")
      .replace(/^@material-ui\/core.legacy$/, "@mui/material.legacy")
      .replace(/^@material-ui\/icons$/, "@mui/material-icons")
      .replace(/^@material-ui\/unstyled$/, "@mui/core")
      // org rename
      .replace(/^@material-ui\/([\w-]+)$/, "@mui/$1")
      // path renames
      .replace(
        /^packages\/material-ui\/material-ui\.production\.min\.js$/,
        "packages/mui-material/material-ui.production.min.js"
      )
      .replace(/^@material-ui\/core\//, "")
      .replace(/\.esm$/, "")
  );
}

async function getBaseSnapshot(baseRef: string, baseCommit: string) {
  const baseSnapshotUrl = new URL(
    `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/${encodeURIComponent(
      baseRef
    )}/${encodeURIComponent(baseCommit)}/size-snapshot.json`
  );
  const baseSnapshot = await axios.get(baseSnapshotUrl.href);
  return baseSnapshot.data;
}

async function getTargetSnapshot(circleCIBuildNumber: string) {
  const artifactsUrl = `https://circleci.com/api/v2/project/gh/mui/material-ui/${encodeURIComponent(
    circleCIBuildNumber
  )}/artifacts`;
  const { data: artifacts } = await axios.get(artifactsUrl);
  const entry = artifacts.items.find(
    (entry) => entry.path === "size-snapshot.json"
  );
  if (!entry) {
    throw new Error(
      `No artifacts found for build ${circleCIBuildNumber} (${artifactsUrl})`
    );
  }
  const { data } = await axios.get(entry.url);
  return data;
}

const NULL_SNAPSHOT = { parsed: 0, gzip: 0 };

interface Size {
  parsed: {
    previous: number;
    current: number;
    absoluteDiff: number;
    relativeDiff: number;
  };
  gzip: {
    previous: number;
    current: number;
    absoluteDiff: number;
    relativeDiff: number;
  };
}

function getSizeInfo<K extends string>(
  property: K,
  current: Record<K, number>,
  previous: Record<K, number>
) {
  const absoluteDiff = current[property] - previous[property];
  const relativeDiff = current[property] / previous[property] - 1;
  return {
    [`previous.${property}`]: previous[property],
    [`current.${property}`]: current[property],
    [`absoluteDiff.${property}`]: absoluteDiff ? absoluteDiff : undefined,
    [`relativeDiff.${property}`]: relativeDiff ? relativeDiff : undefined,
  };
}

export const getBundleSizes = createFunction(
  async ({ parameters }) => {
    const [base, target] = await Promise.all([
      getBaseSnapshot(
        parameters.baseRef as string,
        parameters.baseCommit as string
      ),
      getTargetSnapshot(parameters.circleCIBuildNumber as string),
    ]);

    const bundles = new Set([...Object.keys(base), ...Object.keys(target)]);
    return Array.from(bundles, (bundle) => {
      const currentSize = target[bundle] || NULL_SNAPSHOT;
      const previousSize = base[bundle] || NULL_SNAPSHOT;

      const entry = {
        id: bundle,
        name: getMainBundleLabel(bundle),
        ...getSizeInfo("parsed", currentSize, previousSize),
        ...getSizeInfo("gzip", currentSize, previousSize),
      };

      return entry;
    }).sort(
      (a, b) =>
        Math.abs(b["absoluteDiff.parsed"] || 0) -
        Math.abs(a["absoluteDiff.parsed"] || 0)
    );
  },
  {
    parameters: {
      baseRef: {
        typeDef: { type: "string" },
        defaultValue: "master",
      },
      baseCommit: {
        typeDef: { type: "string" },
      },
      circleCIBuildNumber: {
        typeDef: { type: "string" },
      },
    },
  }
);

export const PRsPerMount = createFunction(
  async function PRsPerMount({ parameters }) {
    const openQuery = `
with maintainers as (
  SELECT
    DISTINCT ge.actor_login
  FROM
    github_events ge
  WHERE
    ge.repo_id = ${parameters.repositoryId}
    AND ge.type = 'PullRequestEvent'
    /* maintainers are defined as the ones that are allowed to merge PRs */
    AND ge.action = 'closed'
    AND ge.pr_merged = 1
    AND ge.created_at >= '2016-01-01'
), pr_merged AS (
  SELECT
    number,
    date_format(created_at, '%Y-%m-01') AS event_month,
    actor_login
  FROM
    github_events ge
  WHERE
    type = 'PullRequestEvent'
    AND action = 'closed'
    AND ge.pr_merged = 1
    AND repo_id = ${parameters.repositoryId}
    AND ge.created_at >= '2016-01-01'
), pr_opened as (
  SELECT
    number,
    date_format(created_at, '%Y-%m-01') AS event_month,
    actor_login
  FROM
    github_events ge
  WHERE
    type = 'PullRequestEvent'
    AND action = 'opened'
    AND repo_id = ${parameters.repositoryId}
    AND ge.created_at >= '2016-01-01'
    AND actor_login NOT LIKE '%bot'
    AND actor_login NOT LIKE '%[bot]'
), pr_merged_with_open_by as (
  SELECT
    pr_merged.event_month,
    pr_merged.number,
    pr_opened.actor_login as open_by,
    pr_merged.actor_login as merged_by
  FROM
    pr_merged
    JOIN pr_opened on pr_opened.number = pr_merged.number
), pr_stats as (
  SELECT
    pr_community.event_month,
    COUNT(DISTINCT pr_community.number) AS pr_community_count,
    COUNT(DISTINCT pr_maintainers.number) AS pr_maintainers_count
  FROM pr_merged_with_open_by as pr_community
  LEFT JOIN pr_merged_with_open_by  as pr_maintainers
    ON pr_community.event_month = pr_maintainers.event_month
  WHERE
        pr_community.open_by NOT IN (SELECT actor_login FROM maintainers)
    AND pr_maintainers.open_by IN (SELECT actor_login FROM maintainers)
  GROUP BY
    pr_community.event_month
  ORDER BY
    pr_community.event_month asc
)

SELECT * FROM pr_stats ge;
    `;
    const res = await fetch("https://api.ossinsight.io/q/playground", {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sql: openQuery,
        type: "repo",
        id: parameters.repositoryId,
      }),
      method: "POST",
    });
    if (res.status !== 200) {
      throw new Error(
        `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`
      );
    }
    const data = await res.json();
    return data.data.map((x) => ({ x: x.month, y: x.prs, ...x }));
  },
  {
    parameters: {
      repositoryId: {
        typeDef: { type: "string" },
      },
    },
  }
);
