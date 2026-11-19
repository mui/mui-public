import { highlightCode, classHighlighter } from '@lezer/highlight';
import { parser } from '@lezer/javascript';

const tsx = parser.configure({ dialect: 'ts jsx' });

export const highlight = (source: string, putText: (text: string, classes: string) => void) =>
  highlightCode(source, tsx.parse(source), classHighlighter, putText, () => putText('\n', ''));
