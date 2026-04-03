#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const prUrl = process.argv[2];

if (!prUrl) {
  console.error("Usage: fetch-pr.mjs <pr-url>");
  process.exit(1);
}

// Fetch metadata and diff in parallel
const [{ stdout: metadataRaw }, { stdout: diffRaw }] = await Promise.all([
  execFileAsync("gh", ["pr", "view", prUrl, "--json", "title,body,number,url,baseRefName"]),
  execFileAsync("gh", ["pr", "diff", prUrl], { maxBuffer: 50 * 1024 * 1024 }),
]);

const metadata = JSON.parse(metadataRaw);
const prNumber = metadata.number;

// Extract source repo name from the PR URL
const urlMatch = metadata.url.match(/github\.com\/[^/]+\/([^/]+)\/pull\//);
const sourceRepo = urlMatch ? urlMatch[1] : "unknown";

// Filter out pnpm-lock.yaml from diff
let filtered = "";
let skip = false;
for (const line of diffRaw.split("\n")) {
  if (line.startsWith("diff --git")) {
    skip = line.includes("pnpm-lock.yaml");
  }
  if (!skip) {
    filtered += line + "\n";
  }
}

// Write outputs under .propagate-pr/<source-repo>/<number>/
const outputDir = join(".propagate-pr", sourceRepo, String(prNumber));
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
writeFileSync(join(outputDir, "diff.patch"), filtered);

console.log(outputDir);
