// Toolpad queries:

import axios from "axios";
import { createQuery } from "@mui/toolpad-core";

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
  console.log(bundleId);
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
  const { data: artifacts } = await axios.get(
    `https://circleci.com/api/v2/project/gh/mui/material-ui/${encodeURIComponent(
      circleCIBuildNumber
    )}/artifacts`
  );
  const entry = artifacts.items.find(
    (entry) => entry.path === "size-snapshot.json"
  );
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

export const getBundleSizes = createQuery(
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
