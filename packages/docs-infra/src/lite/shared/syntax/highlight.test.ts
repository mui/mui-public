import { describe, expect, it } from 'vitest';
import { parser as jsParser } from '@lezer/javascript';
import { tokenize, findJsxGenericTypeArgRanges, LANGUAGES } from './highlight';

const classesOf = (src: string, langKey: keyof typeof LANGUAGES | string, text: string): string[] =>
  tokenize(src, LANGUAGES[langKey])
    .filter((token) => token.text === text)
    .map((token) => token.classes);

describe('spread operator', () => {
  // `...` is stock-tagged the too-broad tags.punctuation and is colored via a
  // `styleTags({ Spread })` rule (not a tree fixup) - assert every context.
  it('colors `...` as `pl-k pl-pu` in calls, arrays, objects, and params', () => {
    for (const src of ['f(...x)', '[...a]', '({ ...o })', '({ ...rest }) => rest']) {
      expect(classesOf(src, 'tsx', '...')).toEqual(['pl-k pl-pu']);
    }
  });
});

describe('CSS custom properties', () => {
  it('colors declarations and references as variables', () => {
    expect(classesOf(':root { --size: 1px; height: var(--size); }', 'css', '--size')).toEqual([
      'pl-v',
      'pl-v',
    ]);
  });
});

describe('HTML', () => {
  it('colors tag names, attributes, and values', () => {
    const source = '<button type="button" disabled>Save</button>';
    expect(classesOf(source, 'html', 'button')).toEqual(['pl-ent pl-ht', 'pl-ent pl-ht']);
    expect(classesOf(source, 'html', 'type')).toEqual(['pl-ak']);
    expect(classesOf(source, 'html', 'disabled')).toEqual(['pl-ak']);
    expect(classesOf(source, 'html', '"button"')).toEqual(['pl-s pl-av']);
  });
});

describe('JSX generic type argument grammar gap', () => {
  const source = 'const x = <Item.Root<Payload> open />;\n';

  // findJsxGenericTypeArgRanges depends on @lezer/javascript misparsing
  // `<Component<T>>` in a specific way. Keep this pinned to detect grammar changes.
  it('still misparses `<Component<T>>` with the detected signature', () => {
    const parser = jsParser.configure({ dialect: 'jsx ts' });
    let signatureSeen = false;
    parser.parse(source).iterate({
      enter(node) {
        if (node.name !== 'JSXMemberExpression' && node.name !== 'JSXIdentifier') {
          return;
        }
        const parent = node.node.parent;
        if (
          parent &&
          parent.to === node.to &&
          (parent.name === 'JSXSelfClosingTag' || parent.name === 'JSXOpenTag') &&
          source[node.to] === '<'
        ) {
          signatureSeen = true;
        }
      },
    });
    expect(signatureSeen).toBe(true);
  });

  it('recovers the `<TypeArg>` range from the misparse', () => {
    const ranges = findJsxGenericTypeArgRanges(source, LANGUAGES.tsx);
    expect(ranges).toHaveLength(1);
    expect(source.slice(ranges[0].from, ranges[0].to)).toBe('<Payload>');
  });
});
