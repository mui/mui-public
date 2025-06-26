import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import rule from './docgen-ignore-before-comment.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
  },
});

ruleTester.run('ignore-before-comment', rule, {
  valid: [
    '\n/**\n * @ignore\n */\n',
    '\n/**\n * @ignore\n * Comment.\n */\n',
    '\n/**\n * @ignore\n * Multi-line\n * comment.\n */\n',
    '\n  /**\n   * @ignore\n   * Indented\n   * multi-line\n   * comment.\n   */\n',
  ],
  invalid: [
    {
      code: '\n/**\n * Comment.\n * @ignore\n */\n',
      errors: [
        {
          message: '@ignore should be at the beginning of a block comment.',
          type: 'Block',
        },
      ],
    },
    {
      code: '\n  /**\n   * Multi-line\n   * comment.\n   * @ignore\n   */\n',
      errors: [
        {
          message: '@ignore should be at the beginning of a block comment.',
          type: 'Block',
        },
      ],
    },
    {
      code: '\n  /**\n   * Multi-line\n   * @ignore\n   * comment.\n   */\n',
      errors: [
        {
          message: '@ignore should be at the beginning of a block comment.',
          type: 'Block',
        },
      ],
    },
    {
      code: '\n  /**\n   * Indented\n   * multi-line\n   * comment.\n   * @ignore\n   */\n',
      errors: [
        {
          message: '@ignore should be at the beginning of a block comment.',
          type: 'Block',
        },
      ],
    },
  ],
});
