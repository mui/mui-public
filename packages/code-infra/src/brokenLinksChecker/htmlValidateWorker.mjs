import { workerData, parentPort } from 'node:worker_threads';
import { HtmlValidate, StaticConfigLoader, staticResolver } from 'html-validate';

const { htmlValidateConfig, rawContent, pageUrl } = workerData;

const muiHtmlValidateResolver = staticResolver({
  configs: {
    'mui:recommended': {
      extends: ['html-validate:recommended'],
    },
  },
});

const htmlValidator = new HtmlValidate(
  new StaticConfigLoader([muiHtmlValidateResolver], htmlValidateConfig),
);

const report = await htmlValidator.validateString(rawContent, pageUrl);

/** @type {import('node:worker_threads').MessagePort} */ (parentPort).postMessage({
  pageUrl,
  results: report.valid ? null : report.results,
});
