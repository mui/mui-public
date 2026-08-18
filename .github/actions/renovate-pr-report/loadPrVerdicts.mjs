// Rebuilds the verdict cache from each PR's own sticky comment, fetched alongside the
// PRs by action.yml. Keyed by head SHA, so a rebase invalidates the entry naturally.
import fs from 'node:fs';
import { parseVerdictState, selectTrustedComments } from './reportState.mjs';

const workDir = process.env.WORK_DIR;
const read = (name) => JSON.parse(fs.readFileSync(`${workDir}/${name}`, 'utf8'));

const pages = read('prs.json');
const actors = read('trusted-actors.json');

const cache = {};
const verdictComments = {};
for (const pr of pages.flatMap((page) => page.data.repository.pullRequests.nodes)) {
  const comments = selectTrustedComments(pr.comments?.nodes, actors.commentAuthor);
  const state = parseVerdictState(comments, process.env.VERDICT_MARKER);
  if (state) {
    verdictComments[pr.number] = { id: state.commentId, reported: state.reported };
    if (state.verdict && state.sha) {
      cache[`${pr.number}:${state.sha}`] = state.verdict;
    }
  }
}

fs.writeFileSync(`${workDir}/cache.json`, JSON.stringify(cache));
fs.writeFileSync(`${workDir}/verdict-comments.json`, JSON.stringify(verdictComments));
