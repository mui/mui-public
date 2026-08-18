import fs from 'node:fs';
import { selectDashboardIssue } from './githubUtils.mjs';

const workDir = process.env.WORK_DIR;
const issues = JSON.parse(fs.readFileSync(`${workDir}/dashboard-issues.json`, 'utf8'));
const actors = JSON.parse(fs.readFileSync(`${workDir}/trusted-actors.json`, 'utf8'));
const issue = selectDashboardIssue(issues, process.env.DASHBOARD_TITLE, actors.bot);

if (issue !== null) {
  process.stdout.write(String(issue));
}
