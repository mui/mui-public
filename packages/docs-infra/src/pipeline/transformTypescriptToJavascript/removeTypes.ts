// Based on https://github.com/ember-cli/babel-remove-types/blob/fc3be010e99c4f4926fd70d00242d6777ab1b8d7/src/index.ts
// Converted to use Babel standalone, with added TSX support

import * as Babel from '@babel/standalone';
import { format } from 'prettier/standalone';
import pluginBabel from 'prettier/plugins/babel';
import pluginEstree from 'prettier/plugins/estree';
import type { Options as PrettierOptions } from 'prettier';
import type { VisitNodeObject, Node } from '@babel/traverse';

/**
 * Strips TypeScript types and decorators from code (including React in TSX),
 * preserving blank lines and optionally formatting with Prettier.
 *
 * @param code - The source code string to transform.
 * @param filename - The name of the file (e.g. "foo.ts" or "Foo.tsx").
 *                   Determines whether TSX parsing is enabled.
 * @param prettierConfig - `true` for default formatting, `false` to skip,
 *                         or a Prettier options object to customize.
 * @returns The transformed (and optionally formatted) code.
 */
export async function removeTypes(
  code: string,
  filename = 'file.ts',
  prettierConfig: PrettierOptions | boolean = true,
): Promise<string> {
  // Babel collapses newlines all over the place, which messes with the formatting of almost any
  // code you pass to it. To preserve the formatting, we go through and mark all the empty lines
  // in the code string *before* transforming it. This allows us to go back through after the
  // transformation re-insert the empty lines in the correct place relative to the new code that
  // has been generated.
  code = code.replace(/\n\n+/g, '/* ___NEWLINE___ */\n');

  // When removing TS-specific constructs (e.g. interfaces), we want to make sure we also remove
  // any comments that are associated with those constructs, since otherwise we'll be left with
  // comments that refer to something that isn't actually there.
  // Credit to https://github.com/cyco130/detype for figuring out this very useful pattern
  const removeComments: VisitNodeObject<unknown, Node> = {
    enter(nodePath) {
      if (!nodePath.node.leadingComments) {
        return;
      }

      for (let i = nodePath.node.leadingComments.length - 1; i >= 0; i -= 1) {
        const comment = nodePath.node.leadingComments[i];
        if (
          code.slice(comment.end).match(/^\s*\n\s*\n/) ||
          comment.value.includes('___NEWLINE___')
        ) {
          // There is at least one empty line between the comment and the TypeScript specific construct
          // We should keep this comment and those before it
          break;
        }
        comment.value = '___REMOVE_ME___';
      }
    },
  };

  const isTSX = /\.tsx$/i.test(filename);

  const transformed = Babel.transform(code, {
    filename,
    plugins: [
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
      [
        'transform-typescript',
        {
          onlyRemoveTypeImports: true,
          isTSX,
          allExtensions: true,
        },
      ],
      ['proposal-decorators', { legacy: true }],
    ],
    generatorOpts: {
      retainLines: true,
      shouldPrintComment: (c: string) => c !== '___REMOVE_ME___',
    },
  });

  if (!transformed || !transformed.code) {
    throw new Error('There was an issue with the Babel transform.');
  }

  const fixed = transformed.code.replace(/\/\* ___NEWLINE___ \*\//g, '\n');

  // If the user has *explicitly* passed `false` here, it means they do not want us to run Prettier
  // at all, so we bail here.
  if (prettierConfig === false) {
    return fixed;
  }

  const standardPrettierOptions: PrettierOptions = {
    parser: 'babel',
    singleQuote: true,
    plugins: [pluginBabel, pluginEstree],
  };

  // If `prettierConfig` is *explicitly* true (as opposed to truthy), it means the user has opted in
  // to default behavior either explicitly or implicitly. Either way, we run basic Prettier on it.
  if (prettierConfig === true) {
    return format(fixed, standardPrettierOptions);
  }

  // If we've made it here, the user has passed their own Prettier options so we merge it with ours
  // and let theirs overwrite any of the default settings.
  const mergedPrettierOptions: PrettierOptions = {
    ...standardPrettierOptions,
    ...prettierConfig,
    plugins: standardPrettierOptions.plugins,
  };

  return format(fixed, mergedPrettierOptions);
}
