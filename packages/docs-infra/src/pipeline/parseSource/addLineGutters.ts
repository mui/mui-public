// Example copied from https://github.com/wooorm/starry-night#example-adding-line-numbers

import type { ElementContent, RootContent, Root } from 'hast';

export function starryNightGutter(tree: Root): void {
  /** @type {Array<RootContent>} */
  const replacement: Array<RootContent> = [];
  const search = /\r?\n|\r/g;
  let index = -1;
  let start = 0;
  let startTextRemainder = '';
  let lineNumber = 0;

  while (index + 1 < tree.children.length) {
    index += 1;
    const child = tree.children[index];

    if (child.type === 'text') {
      let textStart = 0;
      let match = search.exec(child.value);

      while (match) {
        // Nodes in this line.
        const line: Array<ElementContent> = tree.children.slice(
          start,
          index,
        ) as Array<ElementContent>;

        // Prepend text from a partial matched earlier text.
        if (startTextRemainder) {
          line.unshift({ type: 'text', value: startTextRemainder });
          startTextRemainder = '';
        }

        // Append text from this text.
        if (match.index > textStart) {
          line.push({
            type: 'text',
            value: child.value.slice(textStart, match.index),
          });
        }

        // Add a line, and the eol.
        lineNumber += 1;
        replacement.push(createLine(line, lineNumber), {
          type: 'text',
          value: match[0],
        });

        start = index + 1;
        textStart = match.index + match[0].length;
        match = search.exec(child.value);
      }

      // If we matched, make sure to not drop the text after the last line ending.
      if (start === index + 1) {
        startTextRemainder = child.value.slice(textStart);
      }
    }
  }

  const line: Array<ElementContent> = tree.children.slice(start) as Array<ElementContent>;
  // Prepend text from a partial matched earlier text.
  if (startTextRemainder) {
    line.unshift({ type: 'text', value: startTextRemainder });
    startTextRemainder = '';
  }

  if (line.length > 0) {
    lineNumber += 1;
    replacement.push(createLine(line, lineNumber));
  }

  // Replace children with new array.
  tree.children = replacement;
}

function createLine(children: Array<ElementContent>, line: number): RootContent {
  return {
    type: 'element' as const,
    tagName: 'span',
    properties: { className: 'line', dataLineNumber: line },
    children,
  };
}
