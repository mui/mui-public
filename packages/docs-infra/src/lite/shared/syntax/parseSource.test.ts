import { describe, expect, it } from 'vitest';
import type { Element, Root, RootContent } from 'hast';
import { parseSource, splitFocusFrame, splitFocusFrameRange } from './parseSource';

function textOf(node: Root | RootContent): string {
  if (node.type === 'text') {
    return node.value;
  }
  if ('children' in node) {
    return node.children.map(textOf).join('');
  }
  return '';
}

function isElement(node: Root | RootContent): node is Element {
  return node.type === 'element';
}

function linesOf(root: Root): Element[] {
  const frame = root.children[0];
  if (!isElement(frame)) {
    throw new Error('expected a frame element at the tree root');
  }
  return frame.children.filter(isElement);
}

function marksOf(line: Element): string[] {
  return line.children
    .filter((child): child is Element => isElement(child) && child.tagName === 'mark')
    .map(textOf);
}

function isHighlighted(line: Element): boolean {
  return 'dataHl' in (line.properties ?? {});
}

describe('parseSource emphasis directives', () => {
  it('strips directive comments and applies line highlights and text marks', () => {
    const source = [
      '<Tabs.Root defaultValue="overview">',
      '  <Tabs.List>',
      '    {/* @highlight-start */}',
      '    {/* @highlight-text "nativeButton={false}" "render" */}',
      '    <Tabs.Tab nativeButton={false} render={<Link href="/overview" />} value="overview">',
      '      Overview',
      '    </Tabs.Tab>',
      '    {/* @highlight-end */}',
      '  </Tabs.List>',
      '</Tabs.Root>;',
      '',
    ].join('\n');
    const root = parseSource(source, 'a.tsx');
    const lines = linesOf(root);

    expect(textOf(root)).not.toContain('@highlight');
    expect(root.data?.totalLines).toBe(7);
    expect(lines.map(isHighlighted)).toEqual([false, false, true, true, true, false, false]);
    expect(marksOf(lines[2])).toEqual(['nativeButton={false}', 'render']);
  });

  it('marks @highlight-text targets regardless of their order on the line', () => {
    const source = [
      '// @highlight-text "state" "errors" "formAction"',
      '<Form action={formAction} errors={state.errors}>',
      '</Form>;',
      '',
    ].join('\n');
    const root = parseSource(source, 'a.tsx');
    expect(marksOf(linesOf(root)[0])).toEqual(['formAction', 'errors', 'state']);
  });

  it('advances repeated @highlight-text targets to successive occurrences', () => {
    const source = [
      '// @highlight-text "errors" "errors"',
      'const errors = mergeErrors(errors);',
      '',
    ].join('\n');
    const root = parseSource(source, 'a.ts');
    expect(marksOf(linesOf(root)[0])).toEqual(['errors', 'errors']);
  });

  it('folds a tight {// brace into a stripped trailing directive', () => {
    const source = [
      '<Form',
      '  errors={errors} {// @highlight-text "errors"',
      '  onSubmit={fn}',
      '>',
      '</Form>;',
      '',
    ].join('\n');
    const root = parseSource(source, 'a.tsx');
    const line = linesOf(root)[1];
    expect(textOf(line)).toBe('  errors={errors}');
    expect(marksOf(line)).toEqual(['errors']);
  });

  it('marks @highlight-text targets in css comments', () => {
    const source = ['.demo {', '  /* @highlight-text "40px" */', '  width: 40px;', '}', ''].join(
      '\n',
    );
    const root = parseSource(source, 'a.css');
    expect(marksOf(linesOf(root)[1])).toEqual(['40px']);
  });

  it('reports focus ranges and post-strip totalLines without highlighting', () => {
    const source = [
      'const a = 1;',
      '// @focus-start',
      'const b = 2;',
      'const c = 3;',
      '// @focus-end',
      'const d = 4;',
      '',
    ].join('\n');
    const root = parseSource(source, 'a.ts');
    expect(root.data?.totalLines).toBe(4);
    expect(root.data?.focusRange).toEqual({ start: 2, end: 3 });
    expect(linesOf(root).some(isHighlighted)).toBe(false);
  });

  it('leaves sources without directives untouched', () => {
    const source = 'const url = "mailto:a@highlight.dev";\n';
    const root = parseSource(source, 'a.ts');
    expect(textOf(root)).toBe(source);
    expect(root.data).toEqual({ totalLines: 1, focusRange: null });
  });
});

describe('parseSource emphasis directive modifiers', () => {
  it('recognizes @focus-start with a @padding modifier and expands the focus range', () => {
    const source = [
      'const a = 1;',
      'const b = 2;',
      '// @focus-start @padding 1',
      'const c = 3;',
      '// @focus-end',
      'const d = 4;',
      'const e = 5;',
      '',
    ].join('\n');
    const root = parseSource(source, 'a.ts');
    expect(textOf(root)).not.toContain('@focus');
    expect(root.data?.totalLines).toBe(5);
    expect(root.data?.focusRange).toEqual({ start: 2, end: 4 });
  });

  it('applies @padding on a single-line @focus directive', () => {
    const source = [
      'const a = 1;',
      'const b = 2;',
      'const c = 3; // @focus @padding 1',
      'const d = 4;',
      'const e = 5;',
      '',
    ].join('\n');
    const root = parseSource(source, 'a.ts');
    expect(textOf(root)).toContain('const c = 3;');
    expect(root.data?.focusRange).toEqual({ start: 2, end: 4 });
  });

  it('clamps a padded focus range at the file boundaries', () => {
    const source = ['const a = 1; // @focus @padding 3', 'const b = 2;', ''].join('\n');
    const root = parseSource(source, 'a.ts');
    expect(root.data?.totalLines).toBe(2);
    expect(root.data?.focusRange).toEqual({ start: 1, end: 2 });
  });

  it('still applies a directive whose unknown modifiers are ignored', () => {
    const source = ['const a = 1;', 'const b = 2; // @focus @min 6', ''].join('\n');
    const root = parseSource(source, 'a.ts');
    expect(textOf(root)).not.toContain('@min');
    expect(root.data?.focusRange).toEqual({ start: 2, end: 2 });
  });

  it('recognizes @highlight with a trailing modifier and ignores the padding', () => {
    const source = ['const a = 1; // @highlight @padding 2', 'const b = 2;', ''].join('\n');
    const root = parseSource(source, 'a.ts');
    expect(textOf(root)).not.toContain('@highlight');
    expect(linesOf(root).map(isHighlighted)).toEqual([true, false]);
    expect(root.data?.focusRange).toBeNull();
  });

  it('tolerates a quoted description after a directive', () => {
    const source = [
      '// @focus-start "primary preview area"',
      'const a = 1;',
      '// @focus-end',
      '',
    ].join('\n');
    const root = parseSource(source, 'a.ts');
    expect(textOf(root)).not.toContain('primary preview area');
    expect(root.data?.focusRange).toEqual({ start: 1, end: 1 });
  });

  it('does not treat a longer word sharing a directive prefix as a directive', () => {
    const source = ['// @focused on performance here', 'const a = 1;', ''].join('\n');
    const root = parseSource(source, 'a.ts');
    expect(textOf(root)).toContain('@focused on performance here');
    expect(root.data?.focusRange).toBeNull();
  });
});

describe('parseSource JSX generic type arguments', () => {
  it('reconstructs the source exactly and styles the tag attributes', () => {
    const source =
      'const x = <AlertDialog.Root<Payload> handle={h} open>{child}</AlertDialog.Root>;\n';
    const root = parseSource(source, 'a.tsx');
    expect(textOf(root)).toBe(source);
    const spans = linesOf(root)[0].children.filter(isElement);
    const classOf = (text: string) =>
      spans
        .filter((span) => textOf(span) === text)
        .map((span) => (span.properties.className as string[]).join(' '));
    expect(classOf('Payload')).toEqual(['pl-en']);
    expect(classOf('handle')).toEqual(['pl-ak']);
    expect(classOf('open')).toEqual(['pl-ak']);
  });

  it('handles function types inside the type argument', () => {
    const source = 'const x = <Item.Root<(v: string) => void> handle={h} open />;\n';
    expect(textOf(parseSource(source, 'a.tsx'))).toBe(source);
  });
});

describe('parseSource JSX member tags', () => {
  const tokensOf = (src: string): Array<[string, string]> =>
    linesOf(parseSource(src, 'a.tsx'))[0]
      .children.filter(isElement)
      .map((child) => [textOf(child), (child.properties.className as string[]).join(' ')]);

  it('colors a lowercase member-tag base as a component, not an html tag', () => {
    const tokens = tokensOf('const x = <form.Field name="a" />;\n');
    expect(tokens).toContainEqual(['form', 'pl-jt']);
    expect(tokens).toContainEqual(['.', 'pl-jt']);
    expect(tokens).toContainEqual(['Field', 'pl-jt']);
  });

  it('colors every part of a nested member tag', () => {
    const tokens = tokensOf('const x = <a.b.c />;\n');
    for (const part of ['a', 'b', 'c']) {
      expect(tokens).toContainEqual([part, 'pl-jt']);
    }
    expect(tokens.filter((token) => token[0] === '.').map((token) => token[1])).toEqual([
      'pl-jt',
      'pl-jt',
    ]);
  });

  it('keeps plain lowercase tags html-colored', () => {
    const tokens = tokensOf('const x = <form action="/a" />;\n');
    expect(tokens).toContainEqual(['form', 'pl-ent pl-ht']);
  });
});

describe('parseSource parameter destructuring', () => {
  const tokensOf = (src: string): Array<[string, string]> =>
    linesOf(parseSource(src, 'a.tsx'))[0]
      .children.filter(isElement)
      .map((child) => [textOf(child), (child.properties.className as string[]).join(' ')]);

  it('colors every name bound by a param pattern as a parameter', () => {
    const tokens = tokensOf('const f = ({ payload, other: renamed, ...rest }, [x]) => payload;\n');
    for (const name of ['payload', 'other', 'renamed', 'rest', 'x']) {
      expect(tokens).toContainEqual([name, 'pl-v']);
    }
    expect(tokens.filter((token) => token[0] === 'payload').map((token) => token[1])).toEqual([
      'pl-v',
      'pl-smi',
    ]);
  });

  it('keeps non-param destructuring and default values stock-colored', () => {
    const tokens = tokensOf('const { open } = props;\n');
    expect(tokens).toContainEqual(['open', 'pl-c1']);

    const withDefault = tokensOf('const f = ({ a = other }) => a;\n');
    expect(withDefault).toContainEqual(['a', 'pl-v']);
    expect(withDefault).toContainEqual(['other', 'pl-smi']);
  });
});

describe('splitFocusFrameRange', () => {
  const parse = () => parseSource('l1\nl2\nl3\nl4\nl5\n', 'a.txt');
  const frameTypes = (root: Root) =>
    root.children.map((frame) =>
      isElement(frame) ? ((frame.properties?.dataFrameType as string | undefined) ?? null) : null,
    );

  it('splits a mid-file range into lead, focus, and trail frames', () => {
    const root = splitFocusFrameRange(parse(), 2, 3);
    expect(frameTypes(root)).toEqual([null, 'focus', null]);
    expect(root.children.map(textOf)).toEqual(['l1\n', 'l2\nl3\n', 'l4\nl5\n']);
  });

  it('clamps an overflowing end line', () => {
    const root = splitFocusFrameRange(parse(), 4, 9);
    expect(frameTypes(root)).toEqual([null, 'focus']);
    expect(textOf(root.children[1])).toBe('l4\nl5\n');
  });

  it('returns the tree unchanged when the range covers everything', () => {
    expect(frameTypes(splitFocusFrameRange(parse(), 1, 5))).toEqual([null]);
  });

  it('keeps splitFocusFrame as the first-N-lines case', () => {
    const root = splitFocusFrame(parse(), 2);
    expect(frameTypes(root)).toEqual(['focus', null]);
    expect(textOf(root.children[0])).toBe('l1\nl2\n');
  });
});
