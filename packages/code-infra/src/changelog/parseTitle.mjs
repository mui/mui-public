/**
 * Read bracket prefixes once so classification, sorting, and rendering share the same grammar.
 * @param {string} message
 * @returns {{ tags: string[]; remaining: string }}
 */
export function parseTitle(message) {
  const subject = message.split('\n')[0].trim();
  const prefix = subject.match(/^(?:\[[^\]\r\n]+\])+/)?.[0] ?? '';
  return {
    tags: [...prefix.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]),
    remaining: subject.slice(prefix.length).trimStart(),
  };
}
