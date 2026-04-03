#!/usr/bin/env node

// Usage: inspect-repos.mjs '{"repos": [{"repo": "base-ui", "path": "../base-ui"}, ...]}'
// For each repo, checks if the path exists and is a git repo, inspects remotes,
// and determines upstream/push remote names and fork owner.
// Outputs JSON array of results.

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const input = JSON.parse(process.argv[2]);

const results = await Promise.all(
  input.repos.map(async ({ repo, path }) => {
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

    // Find push remote (fork = not mui, or same as upstream for direct clones)
    const forkRemote = remotes.find(
      (r) => r.owner !== "mui" && r.repoName === repo,
    );
    const pushRemote = forkRemote || upstreamRemote;

    return {
      repo,
      path,
      status: "ok",
      upstreamRemote: upstreamRemote.name,
      pushRemote: pushRemote.name,
      forkOwner: pushRemote.owner,
      isDirect: !forkRemote,
    };
  }),
);

console.log(JSON.stringify(results, null, 2));
