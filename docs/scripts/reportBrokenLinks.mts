import { crawl } from '@mui/internal-code-infra/brokenLinksChecker';

async function main() {
  const { issues } = await crawl({
    startCommand: 'pnpm start --no-request-logging -p 3001',
    host: 'http://localhost:3001/',
    // Target paths to ignore during link checking
    ignoredPaths: [],
    // CSS selectors for content to ignore during link checking
    ignoredContent: [],
    htmlValidate: {
      rules: {
        // TODO @dav-is: re-enable 'no-dup-id' rule after fixing duplicate IDs in the documentation.
        'no-dup-id': 'off',
      },
    },
  });

  process.exit(issues.length);
}

main();
