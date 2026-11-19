import { parser as cssParser } from '@lezer/css';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import { configureNesting, parser as htmlParser } from '@lezer/html';
import { parser as jsParser } from '@lezer/javascript';
import { parser as jsonParser } from '@lezer/json';
import { GFM, parseCode, parser as markdownParser } from '@lezer/markdown';
import { parser as yamlParser } from '@lezer/yaml';

const tsx = jsParser.configure({ dialect: 'ts jsx' });
const html = htmlParser.configure({
  wrap: configureNesting([
    { tag: 'script', parser: tsx },
    { tag: 'style', parser: cssParser },
  ]),
});
const parsers = {
  tsx,
  json: jsonParser,
  css: cssParser,
  html,
  yaml: yamlParser,
  md: markdownParser.configure([GFM, parseCode({ htmlParser: html })]),
};

export const highlight = (
  source: string,
  language: keyof typeof parsers,
  putText: (text: string, classes: string) => void,
) =>
  highlightCode(source, parsers[language].parse(source), classHighlighter, putText, () =>
    putText('\n', ''),
  );
