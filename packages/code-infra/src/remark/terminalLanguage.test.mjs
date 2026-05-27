import { describe, it, expect } from 'vitest';
import { createLintTester } from './createLintTester.mjs';
import plugin from './terminalLanguage.mjs';

const lint = createLintTester(plugin);

describe('remark-lint-mui-terminal-language', () => {
  it('accepts bash and other languages', () => {
    expect(lint(`\`\`\`bash\necho hi\n\`\`\`\n`)).toEqual([]);
    expect(lint(`\`\`\`js\nconst x = 1;\n\`\`\`\n`)).toEqual([]);
  });

  it('flags `sh` code fences', () => {
    const messages = lint(`\`\`\`sh\necho hi\n\`\`\`\n`);
    expect(messages).toHaveLength(1);
  });
});
