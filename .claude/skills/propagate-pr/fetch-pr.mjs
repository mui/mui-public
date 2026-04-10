#!/usr/bin/env node

// Fetches PR diff (excluding pnpm-lock.yaml), saves it to disk for subagents,
// and outputs the filtered diff to stdout for context injection.
// Also saves metadata.json alongside the diff.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const prUrl = process.argv[2];

if (!prUrl) {
  console.error("Usage: fetch-pr.mjs <pr-url>");
  process.exit(1);
}

// Fetch metadata and diff in parallel
const [{ stdout: metadataRaw }, { stdout: diffRaw }] = await Promise.all([
  execFileAsync("gh", [
    "pr",
    "view",
    prUrl,
    "--json",
    "title,body,number,url,baseRefName",
  ]),
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

// Save to disk for subagents
const outputDir = join(".propagate-pr", sourceRepo, String(prNumber));
await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(
    join(outputDir, "metadata.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  ),
  writeFile(join(outputDir, "diff.patch"), filtered),
]);

// Output the diff path for subagents to reference
console.log(resolve(outputDir, "diff.patch"));
