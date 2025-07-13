// Based on https://github.com/ember-cli/babel-remove-types/blob/main/src/index.ts
// converted to use Babel standalone

import * as Babel from '@babel/standalone';
import prettier from 'prettier/standalone';
import prettierPluginEstree from 'prettier/plugins/estree';
import parserBabel from 'prettier/parser-babel';
import type { Options as PrettierOptions } from 'prettier';

/**
 * removeTypes
 *
 * Strips TypeScript types and decorators from code, preserving blank lines
 * and optionally formatting with Prettier.
 *
 * @param code - The source code string to transform.
 * @param prettierConfig - `true` for default formatting, `false` to skip,
 *                         or a Prettier options object to customize.
 * @returns The transformed (and optionally formatted) code.
 */
export async function removeTypes(
  code: string,
  prettierConfig: PrettierOptions | boolean = true,
): Promise<string> {
  // 1) Mark runs of empty lines so they can be reinserted later
  code = code.replace(/\n\n+/g, '/* ___NEWLINE___ */\n');

  // 2) Visitor to strip comments attached to TS-only nodes
  const removeComments = {
    enter(path: any) {
      const node = path.node;
      if (!node.leadingComments) {
        return;
      }
      for (let i = node.leadingComments.length - 1; i >= 0; i -= 1) {
        const comment = node.leadingComments[i];
        // Keep comments followed by a blank line or our marker
        if (
          code.slice(comment.end).match(/^\s*\n\s*\n/) ||
          comment.value.includes('___NEWLINE___')
        ) {
          break;
        }
        comment.value = '___REMOVE_ME___';
      }
    },
  };

  // 3) Run the Babel transform
  const result = Babel.transform(code, {
    // tell Babel it’s TypeScript
    filename: 'file.ts',

    plugins: [
      // your comment-stripping plugin stays the same
      {
        name: 'comment-remover',
        visitor: {
          TSTypeAliasDeclaration: removeComments,
          TSInterfaceDeclaration: removeComments,
          TSDeclareFunction: removeComments,
          TSDeclareMethod: removeComments,
          TSImportType: removeComments,
          TSModuleDeclaration: removeComments,
        },
      },

      // ← use "transform-typescript" here, not "typescript"
      ['transform-typescript', { onlyRemoveTypeImports: true }],

      // decorators plugin is named "proposal-decorators"
      ['proposal-decorators', { legacy: true }],
    ],

    generatorOpts: {
      retainLines: true,
      shouldPrintComment: (c: string) => c !== '___REMOVE_ME___',
    },
  });

  if (!result || !result.code) {
    throw new Error('Babel transform failed');
  }

  // 4) Restore blank lines
  const fixed = result.code.replace(/\/\* ___NEWLINE___ \*\//g, '\n');

  // 5) Optionally format with Prettier
  if (prettierConfig === false) {
    return fixed;
  }
  const defaultOpts: PrettierOptions = {
    parser: 'babel',
    singleQuote: true,
    plugins: [prettierPluginEstree, parserBabel],
  };

  if (prettierConfig === true) {
    return prettier.format(fixed, defaultOpts);
  }

  const mergedOpts: PrettierOptions = {
    ...defaultOpts,
    ...prettierConfig,
    plugins: defaultOpts.plugins,
  };

  return prettier.format(fixed, mergedOpts);
}
