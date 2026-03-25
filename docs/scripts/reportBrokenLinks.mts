import { crawl } from '@mui/internal-code-infra/brokenLinksChecker';

async function main() {
  const { issues, htmlValidateResults } = await crawl({
    startCommand: 'pnpm start --no-request-logging -p 3001',
    host: 'http://localhost:3001/',
    // Target paths to ignore during link checking
    ignoredPaths: [],
    // CSS selectors for content to ignore during link checking
    ignoredContent: [],
  });

  const htmlValidateIssueCount = [...htmlValidateResults.values()].reduce(
    (sum, pageResults) => sum + pageResults.reduce((s, r) => s + r.messages.length, 0),
    0,
  );

  process.exit(issues.length + htmlValidateIssueCount);
}

main();
