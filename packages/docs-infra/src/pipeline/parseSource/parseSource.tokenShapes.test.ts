import { describe, expect, it, beforeAll } from 'vitest';
import { toHtml } from 'hast-util-to-html';
import type { ParseSource } from '../../CodeHighlighter/types';
import { createParseSource } from './parseSource';

describe('parseSource token shapes', () => {
  let parseSource: ParseSource;

  beforeAll(async () => {
    parseSource = await createParseSource();
  });

  const html = (source: string, fileName: string, language?: string) =>
    toHtml(parseSource(source, fileName, language));

  it('wraps strings in pl-s with pl-pds quote delimiters', () => {
    expect(html("const a = 'x';", 'a.ts')).toContain(
      '<span class="pl-s"><span class="pl-pds">\'</span>x<span class="pl-pds">\'</span></span>',
    );
  });

  it('closes empty strings so later tokens keep their own classes', () => {
    expect(html("const a = ''; // note", 'a.ts')).toContain('<span class="pl-c">// note</span>');
  });

  it('keeps a template literal and its interpolations in one pl-s span', () => {
    // eslint-disable-next-line no-template-curly-in-string -- the template literal is the source under test
    const result = html('const s = `a ${b} c`;', 'a.ts');
    expect(result).toContain('<span class="pl-s"><span class="pl-pds">`</span>a ');
    expect(result).toContain('<span class="di-te"><span class="di-td">${</span>');
  });

  it('marks JSX expression braces as pl-pse', () => {
    expect(html('const x = <div title={name} />;', 'a.tsx')).toContain(
      '<span class="pl-pse">{</span>',
    );
  });

  it('marks type-literal members as pl-v with a pl-k colon', () => {
    expect(html('type P = { label?: string };', 'a.ts')).toContain(
      '<span class="pl-v">label</span><span class="pl-k di-pu">?:</span>',
    );
  });

  it('keeps a bare capitalized identifier as pl-smi so it is not linked as a type', () => {
    expect(html('CodeProviderLazy', 'a.tsx')).toContain(
      '<span class="pl-smi">CodeProviderLazy</span>',
    );
    expect(html('const a: Foo = 1;', 'a.ts')).toContain('<span class="pl-en">Foo</span>');
  });

  it('leaves object-literal keys as text for extendSyntaxTokens', () => {
    expect(html('const o = { height: 1 };', 'a.ts')).toContain('<span class="di-op">height</span>');
  });

  it('keeps generic brackets as text but comparison operators as pl-k', () => {
    const result = html('const n = useState<number>(a < b);', 'a.ts');
    expect(result).toContain('useState</span>&#x3C;<span class="pl-c1 di-bt">number</span>>');
    expect(result).toContain('<span class="pl-k di-pu">&#x3C;</span>');
  });

  it('keeps multi-line import bindings as plain identifiers', () => {
    expect(html("import {\n  Alpha,\n} from './alpha';", 'a.ts')).toContain(
      '<span class="pl-smi">Alpha</span>',
    );
  });

  it('keeps indentation outside comment spans', () => {
    expect(html('function a() {\n  // c\n}', 'a.ts')).toContain('  <span class="pl-c">// c</span>');
  });

  it('splits CSS numbers from their units', () => {
    expect(html('a { margin: 4px; }', 'a.css')).toContain('<span class="pl-k">px</span>');
  });

  it('highlights Markdown inline code that the lexer splits into tokens', () => {
    const result = html('Use `<span id>` and `x` here.', 'a.mdx');
    expect(result).toContain('<span class="pl-c1">&#x3C;span id></span>');
    expect(result).toContain('<span class="pl-c1">x</span><span class="pl-s">`</span> here.');
  });

  it('marks lines of a fence without a language as pl-c1', () => {
    expect(html('```\nraw line\n```', 'a.md')).toContain('<span class="pl-c1">raw line</span>');
  });

  it('does not let a quote inside a YAML block scalar swallow later keys', () => {
    expect(html("run: |\n  'unterminated\nname: x", 'a.yaml')).toContain(
      '<span class="pl-ent">name</span>',
    );
  });

  it('classifies diff lines by prefix', () => {
    const result = html('@@ -1 +1 @@ ctx\n-old\n+new', 'change.patch', 'diff');
    expect(result).toContain('<span class="pl-mdr">@@ -1 +1 @@</span> ctx');
    expect(result).toContain('<span class="pl-md">-old</span>');
    expect(result).toContain('<span class="pl-mi1">+new</span>');
  });
});
