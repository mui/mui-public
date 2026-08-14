import fs from 'node:fs';
import { parseReportState, selectTrustedComments } from './reportState.mjs';

const workDir = process.env.WORK_DIR;
const pages = JSON.parse(fs.readFileSync(`${workDir}/comment-pages.json`, 'utf8'));
const comments = selectTrustedComments(pages, process.env.COMMENT_AUTHOR);
const state = parseReportState(comments, process.env.STICKY_MARKER);

fs.writeFileSync(`${workDir}/comments.json`, JSON.stringify(comments));
fs.writeFileSync(`${workDir}/cache.json`, JSON.stringify(state.cache));
fs.writeFileSync(`${workDir}/announced.json`, JSON.stringify(state.announced));
