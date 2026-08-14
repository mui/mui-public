import { describe, it, expect, vi, afterEach } from 'vitest';
import type { HastRoot } from '../../CodeHighlighter/types';
import {
  createEditableSourceProjection,
  createFocusedSourceProjection,
  patchEditableSourceProjection,
} from './createEditableSourceProjection';

/** Shaped like a Material UI demo and its `.tsx.preview` sibling. */
const FULL_SOURCE = [
  "import Stack from '@mui/material/Stack';",
  "import Button from '@mui/material/Button';",
  '',
  'export default function BasicButtons() {',
  '  return (',
  '    <Stack spacing={2} direction="row">',
  '      <Button variant="text">Text</Button>',
  '      <Button variant="outlined">Outlined</Button>',
  '    </Stack>',
  '  );',
  '}',
  '',
].join('\n');

/** Preview files are dedented but keep their relative indentation, and end without a newline. */
const PREVIEW_SOURCE = [
  '<Button variant="text">Text</Button>',
  '<Button variant="outlined">Outlined</Button>',
].join('\n');

const PREVIEW_START = FULL_SOURCE.indexOf('      <Button variant="text"');
const PREVIEW_END = FULL_SOURCE.indexOf('</Button>\n    </Stack>') + '</Button>'.length;

/**
 * Builds a tree of framed lines, marking `visible` ones as the focused window —
 * the shape `getCollapsedFrameWindow` reads.
 */
function buildRoot(lineCount: number, visible: number[], indent = 0): HastRoot {
  const line = (ln: number) => ({
    type: 'element' as const,
    tagName: 'span',
    properties: { className: 'line', dataLn: ln },
    children: [{ type: 'text' as const, value: '\n' }],
  });
  const frame = (type: string, lines: number[]) => ({
    type: 'element' as const,
    tagName: 'span',
    properties: { className: 'frame', dataFrameType: type, dataFrameIndent: indent },
    children: lines.map(line),
  });

  const hidden = Array.from({ length: lineCount }, (unused, index) => index + 1).filter(
    (ln) => !visible.includes(ln),
  );
  return {
    type: 'root',
    data: { collapsible: true },
    children: [frame('focus', visible), frame('normal', hidden)],
  } as unknown as HastRoot;
}

describe('createEditableSourceProjection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('projects a dedented preview onto its indented source region', () => {
    expect(
      createEditableSourceProjection({
        fullSource: FULL_SOURCE,
        previewSource: PREVIEW_SOURCE,
      }),
    ).toEqual({
      // Displayed as authored, the way Material renders the preview file.
      source: PREVIEW_SOURCE,
      start: PREVIEW_START,
      end: PREVIEW_END,
      indentation: '      ',
    });
  });

  it('reports no indentation when the preview already matches the source', () => {
    const fullSource = 'const value = 1;\nexport default value;\n';

    expect(
      createEditableSourceProjection({ fullSource, previewSource: 'const value = 1;' }),
    ).toEqual({ source: 'const value = 1;', start: 0, end: 'const value = 1;'.length });
  });

  it('keeps the relative indentation the preview carries', () => {
    const fullSource = [
      '    <Alert severity="success">',
      '      This is a success Alert.',
      '    </Alert>',
      '',
    ].join('\n');
    const previewSource = '<Alert severity="success">\n  This is a success Alert.\n</Alert>';

    const projection = createEditableSourceProjection({ fullSource, previewSource })!;

    expect(projection.source).toBe(previewSource);
    expect(projection.indentation).toBe('    ');
    expect(patchEditableSourceProjection(fullSource, projection, previewSource)).toBe(fullSource);
  });

  it('matches across differing line endings', () => {
    const fullSource = FULL_SOURCE.replace(/\n/g, '\r\n');
    const projection = createEditableSourceProjection({
      fullSource,
      previewSource: PREVIEW_SOURCE,
    })!;

    expect(fullSource.slice(projection.start, projection.end)).toBe(
      '      <Button variant="text">Text</Button>\r\n      <Button variant="outlined">Outlined</Button>',
    );
  });

  it('handles tab indentation', () => {
    const fullSource = 'function demo() {\n\t\tconst value = 1;\n\t\treturn value;\n}\n';

    expect(
      createEditableSourceProjection({
        fullSource,
        previewSource: 'const value = 1;\nreturn value;',
      }),
    ).toEqual({
      source: 'const value = 1;\nreturn value;',
      start: fullSource.indexOf('\t\tconst'),
      end: fullSource.indexOf('return value;') + 'return value;'.length,
      indentation: '\t\t',
    });
  });

  it('keeps the code before a mid-line match out of the region', () => {
    // `CircularUnderLoad.tsx.preview` is the JSX alone, while the source line
    // returns it. Material replaces only the fragment, so `return ` stays put.
    const fullSource = 'export default function Demo() {\n  return <CircularProgress />;\n}\n';

    const projection = createEditableSourceProjection({
      fullSource,
      previewSource: '<CircularProgress />',
    })!;

    expect(projection.source).toBe('<CircularProgress />');
    expect(projection.indentation).toBeUndefined();
    expect(fullSource.slice(projection.start, projection.end)).toBe('<CircularProgress />');
    expect(patchEditableSourceProjection(fullSource, projection, '<LinearProgress />')).toBe(
      'export default function Demo() {\n  return <LinearProgress />;\n}\n',
    );
  });

  it('absorbs a blank first line in the preview', () => {
    // `BoxBasic.tsx.preview` opens with a blank line and a one-space indent.
    const fullSource = '  return (\n    <Box>\n      Some text.\n    </Box>\n  );\n';

    const projection = createEditableSourceProjection({
      fullSource,
      previewSource: '\n Some text.\n',
    })!;

    expect(projection.source).toBe('Some text.\n');
    expect(projection.indentation).toBe('      ');
    expect(patchEditableSourceProjection(fullSource, projection, projection.source)).toBe(
      fullSource,
    );
  });

  it('refuses a fragment that appears more than once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fullSource = '<Button>Click</Button>\n<hr />\n<Button>Click</Button>\n';

    // Material's `String.replace` would splice the first of the two.
    expect(
      createEditableSourceProjection({ fullSource, previewSource: '<Button>Click</Button>' }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('matches 2 regions'));
  });

  it('returns undefined when the preview is absent from the source', () => {
    expect(
      createEditableSourceProjection({ fullSource: FULL_SOURCE, previewSource: '<Missing />' }),
    ).toBeUndefined();
  });

  it('returns undefined for an empty preview', () => {
    expect(
      createEditableSourceProjection({ fullSource: FULL_SOURCE, previewSource: '' }),
    ).toBeUndefined();
    expect(
      createEditableSourceProjection({ fullSource: FULL_SOURCE, previewSource: '\n  \n' }),
    ).toBeUndefined();
  });

  it('projects a TypeScript preview and its JavaScript twin alike', () => {
    const typescriptSource = 'const value: number = 1;\nexport default value;\n';
    const javascriptSource = 'const value = 1;\nexport default value;\n';

    expect(
      createEditableSourceProjection({
        fullSource: typescriptSource,
        previewSource: 'const value: number = 1;',
      }),
    ).toMatchObject({ source: 'const value: number = 1;', start: 0 });
    expect(
      createEditableSourceProjection({
        fullSource: javascriptSource,
        previewSource: 'const value = 1;',
      }),
    ).toMatchObject({ source: 'const value = 1;', start: 0 });
  });

  it('resolves the same region Material UI patches', () => {
    // Material builds the live source as
    // `trimLeadingSpaces(raw).replace(trimLeadingSpaces(preview), edited)`.
    const edited = '<Button variant="text">Tap</Button>';
    const trimLeadingSpaces = (input: string) => input.replace(/^\s+/gm, '');
    const material = trimLeadingSpaces(FULL_SOURCE).replace(
      trimLeadingSpaces(PREVIEW_SOURCE),
      edited,
    );

    const projection = createEditableSourceProjection({
      fullSource: FULL_SOURCE,
      previewSource: PREVIEW_SOURCE,
    })!;
    const patched = patchEditableSourceProjection(FULL_SOURCE, projection, edited);

    expect(trimLeadingSpaces(patched)).toBe(material);
    // Unlike Material's, the patched source is still indented, since it is displayed again.
    expect(patched).toContain('      <Button variant="text">Tap</Button>');
  });
});

describe('patchEditableSourceProjection', () => {
  it('patches an edit back into the projected range', () => {
    const projection = createEditableSourceProjection({
      fullSource: FULL_SOURCE,
      previewSource: PREVIEW_SOURCE,
    })!;

    expect(
      patchEditableSourceProjection(
        FULL_SOURCE,
        projection,
        PREVIEW_SOURCE.replace('Outlined</Button>', 'Ghost</Button>'),
      ),
    ).toBe(FULL_SOURCE.replace('>Outlined</Button>', '>Ghost</Button>'));
  });

  it('leaves blank lines unindented', () => {
    const fullSource = 'wrap(\n    first();\n    second();\n);\n';
    const projection = createEditableSourceProjection({
      fullSource,
      previewSource: 'first();\nsecond();',
    })!;

    expect(patchEditableSourceProjection(fullSource, projection, 'a();\n\nb();')).toBe(
      'wrap(\n    a();\n\n    b();\n);\n',
    );
  });
});

describe('createFocusedSourceProjection', () => {
  it('projects the focused window, dedented like a preview file', () => {
    expect(createFocusedSourceProjection(FULL_SOURCE, buildRoot(12, [7, 8], 3))).toEqual({
      source: PREVIEW_SOURCE,
      start: PREVIEW_START,
      end: PREVIEW_END,
      indentation: '      ',
    });
  });

  it('agrees with the preview file on the same source', () => {
    expect(createFocusedSourceProjection(FULL_SOURCE, buildRoot(12, [7, 8], 3))).toEqual(
      createEditableSourceProjection({
        fullSource: FULL_SOURCE,
        previewSource: PREVIEW_SOURCE,
      }),
    );
  });

  it('returns undefined for a non-contiguous focus', () => {
    expect(createFocusedSourceProjection(FULL_SOURCE, buildRoot(12, [3, 6]))).toBeUndefined();
  });

  it('returns undefined when the whole file is visible', () => {
    const visible = Array.from({ length: 12 }, (unused, index) => index + 1);
    expect(createFocusedSourceProjection(FULL_SOURCE, buildRoot(12, visible))).toBeUndefined();
  });

  it('returns undefined for a collapse-to-empty block', () => {
    expect(createFocusedSourceProjection(FULL_SOURCE, buildRoot(12, [7, 8]), true)).toBeUndefined();
  });
});
