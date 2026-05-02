#!/usr/bin/env node

// Usage: inspect-repos.mjs base-ui material-ui mui-x ...
// For each repo, checks if ../repo exists and is a git repo, inspects remotes,
// and determines upstream/push remote names and fork owner.
// Outputs JSON array of results.

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const repos = process.argv.slice(2);
if (repos.length === 0) {
  console.error("Usage: inspect-repos.mjs <repo1> <repo2> ...");
  process.exit(1);
}

// Derive paths: sibling directories relative to the project root
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../../..");
const parentDir = resolve(projectRoot, "..");

const results = await Promise.all(
  repos.map(async (repo) => {
    const path = join(parentDir, repo);
    // Check if path exists and is a git repo
    try {
      await access(join(path, ".git"));
    } catch {
      return { repo, path, status: "not_found" };
    }

    // Get remotes
    let stdout;
    try {
      ({ stdout } = await execFileAsync("git", ["-C", path, "remote", "-v"]));
    } catch {
      return { repo, path, status: "git_error" };
    }

    const remotes = [];
    for (const line of stdout.split("\n")) {
      const match = line.match(
        /^(\S+)\s+(https:\/\/github\.com\/([^/]+)\/([^/.\s]+?)(?:\.git)?|git@github\.com:([^/]+)\/([^/.\s]+?)(?:\.git)?)\s+\(fetch\)/,
      );
      if (match) {
        const owner = match[3] || match[5];
        const repoName = match[4] || match[6];
        remotes.push({ name: match[1], owner, repoName });
      }
    }

    // Find upstream remote (points to mui/<repo>)
    const upstreamRemote = remotes.find(
      (r) => r.owner === "mui" && r.repoName === repo,
    );
    if (!upstreamRemote) {
      return { repo, path, status: "no_upstream", remotes };
    }

    // Find push remote — must be "origin"
    const originRemote = remotes.find((r) => r.name === "origin");
    if (!originRemote) {
      return { repo, path, status: "no_origin", remotes };
    }
    const pushRemote = originRemote;

    return {
      repo,
      path,
      status: "ok",
      upstreamRemote: upstreamRemote.name,
      pushRemote: pushRemote.name,
      forkOwner: pushRemote.owner,
      isDirect: originRemote.owner === "mui",
    };
  }),
);

console.log(JSON.stringify(results, null, 2));
