import { describe, it, expect } from 'vitest';
import { remark } from 'remark';
import remarkMdx from 'remark-mdx';
import { createRemarkConfig } from './config.mjs';

/**
 * Runs the public preset against MDX, preserving diagnostic metadata and the output.
 * @param {string} input
 * @param {Parameters<typeof createRemarkConfig>[0]} options
 */
async function lint(input, options = {}) {
  return remark().use(remarkMdx).use(createRemarkConfig(options)).process(input);
}

describe('createRemarkConfig definition comments', () => {
  it('preserves MDX-compatible comments without suppressing unrelated diagnostics', async () => {
    const input = `# Example

[//]: # 'Generated index marker'

[//]: types.ts 'Generated type marker'

[Empty link]()

[Unused]: # 'Real definition'
`;
    const result = await lint(input, { allowDefinitionComments: true });

    expect(
      result.messages.map(({ ruleId, source, fatal, line }) => ({ ruleId, source, fatal, line })),
    ).toEqual([
      { ruleId: 'no-unused-definitions', source: 'remark-lint', fatal: true, line: 9 },
      { ruleId: 'no-empty-url', source: 'remark-lint', fatal: true, line: 7 },
      { ruleId: 'no-empty-url', source: 'remark-lint', fatal: true, line: 9 },
    ]);
    expect(String(result)).toContain('[//]: # "Generated index marker"');
    expect(String(result)).toContain('[//]: types.ts "Generated type marker"');
  });

  it('does not exempt untitled // definitions', async () => {
    const result = await lint('# Example\n\n[//]: #\n', { allowDefinitionComments: true });
    expect(result.messages.map(({ ruleId }) => ruleId)).toEqual([
      'no-unused-definitions',
      'no-empty-url',
    ]);
  });

  it('checks definition comments by default', async () => {
    const result = await lint("# Example\n\n[//]: # 'Comment'\n");
    expect(result.messages.map(({ ruleId }) => ruleId)).toEqual([
      'no-unused-definitions',
      'no-empty-url',
    ]);
  });

  it('preserves overrides with definition comments enabled', async () => {
    const result = await remark()
      .use(remarkMdx)
      .use(
        createRemarkConfig({
          allowDefinitionComments: true,
          overrides: [{ files: '*.mdx', rules: { 'no-empty-url': ['warn'] } }],
        }),
      )
      .process({ path: 'example.mdx', value: "# Example\n\n[//]: # 'Comment'\n\n[Empty]()\n" });
    expect(result.messages.map(({ ruleId, fatal }) => ({ ruleId, fatal }))).toEqual([
      { ruleId: 'no-empty-url', fatal: false },
    ]);
  });
});
