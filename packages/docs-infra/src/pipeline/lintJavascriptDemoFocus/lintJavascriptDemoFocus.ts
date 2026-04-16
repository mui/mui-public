import type { Rule } from 'eslint';
import type { ExportDefaultDeclaration, ExportNamedDeclaration, Node } from 'estree';
import type { TSESTree } from '@typescript-eslint/utils';

type FunctionLikeNode = ExportDefaultDeclaration['declaration'] | Node;

const WRAPPER_TAGS = ['div', 'Box', 'Stack'];

function getTagName(openingElement: TSESTree.JSXOpeningElement): string | null {
  if (openingElement.name.type === 'JSXIdentifier') {
    return openingElement.name.name;
  }
  if (
    openingElement.name.type === 'JSXMemberExpression' &&
    openingElement.name.object.type === 'JSXIdentifier' &&
    openingElement.name.object.name === 'React' &&
    openingElement.name.property.name === 'Fragment'
  ) {
    return 'React.Fragment';
  }
  return null;
}

function isBlankJSXText(child: TSESTree.JSXChild): child is TSESTree.JSXText {
  return child.type === 'JSXText' && !/\S/.test(child.value);
}

function trimBlankJSXText(children: TSESTree.JSXChild[]): TSESTree.JSXChild[] {
  return children.filter((child, index, arr) => {
    const isSurrounding = index === 0 || index === arr.length - 1;
    return !(isSurrounding && isBlankJSXText(child));
  });
}

function isWrapperTag(node: TSESTree.JSXElement): boolean {
  const tagName = getTagName(node.openingElement);
  return tagName !== null && WRAPPER_TAGS.includes(tagName);
}

function isFragmentTag(node: TSESTree.JSXElement): boolean {
  return getTagName(node.openingElement) === 'React.Fragment';
}

function isJSXElement(node: unknown): node is TSESTree.JSXElement {
  return (node as TSESTree.BaseNode).type === 'JSXElement';
}

function isJSXFragment(node: unknown): node is TSESTree.JSXFragment {
  return (node as TSESTree.BaseNode).type === 'JSXFragment';
}

/**
 * Resolves the function body statements from a function-like declaration.
 * Handles FunctionDeclaration, ArrowFunctionExpression, and FunctionExpression.
 */
function getFunctionBody(declaration: FunctionLikeNode): Node[] | null {
  if (declaration.type === 'FunctionDeclaration' && declaration.body) {
    return declaration.body.body;
  }
  if (declaration.type === 'ArrowFunctionExpression' || declaration.type === 'FunctionExpression') {
    if (declaration.body.type === 'BlockStatement') {
      return declaration.body.body;
    }
    return null;
  }
  return null;
}

/**
 * Gets the implicit return expression from an arrow function with expression body.
 */
function getImplicitReturn(declaration: FunctionLikeNode): Node | null {
  if (
    declaration.type === 'ArrowFunctionExpression' &&
    declaration.body.type !== 'BlockStatement'
  ) {
    return declaration.body;
  }
  return null;
}

/**
 * Gets the name of a function-like node.
 * For FunctionDeclaration, returns the id name.
 */
function getFunctionName(node: Node): string | null {
  if (node.type === 'FunctionDeclaration' && node.id) {
    return node.id.name;
  }
  return null;
}

/**
 * Unwraps call expressions (e.g. React.forwardRef, React.memo) to find the
 * inner function argument. Returns the node itself if it is already a function.
 */
function unwrapCallExpression(node: Node): Node | null {
  if (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  ) {
    return node;
  }
  if (node.type === 'CallExpression') {
    for (const arg of node.arguments) {
      if (arg.type !== 'SpreadElement') {
        const inner = unwrapCallExpression(arg);
        if (inner) {
          return inner;
        }
      }
    }
  }
  return null;
}

interface NamedExportFunction {
  name: string | null;
  node: FunctionLikeNode;
}

interface PreviewResult {
  nodes: TSESTree.JSXChild[];
  /** Whether the preview nodes are inside a wrapper element (fix can insert JSX comments) */
  insideWrapper: boolean;
}

/**
 * Determines the preview nodes from a returned JSX value.
 * Wrappers (div, Box, Stack, fragments) are unwrapped to their trimmed children.
 * Non-wrapper elements are returned as-is.
 */
function getPreviewNodes(returnedJSX: unknown): PreviewResult | null {
  if (isJSXElement(returnedJSX)) {
    if (
      (isWrapperTag(returnedJSX) || isFragmentTag(returnedJSX)) &&
      returnedJSX.children.length > 0
    ) {
      const trimmed = trimBlankJSXText(returnedJSX.children);
      if (trimmed.length > 0) {
        return { nodes: trimmed, insideWrapper: true };
      }
    }
    return { nodes: [returnedJSX], insideWrapper: false };
  }
  if (isJSXFragment(returnedJSX) && returnedJSX.children.length > 0) {
    const trimmed = trimBlankJSXText(returnedJSX.children);
    if (trimmed.length > 0) {
      return { nodes: trimmed, insideWrapper: true };
    }
  }
  return null;
}

/**
 * ESLint rule requiring demo files to have focus comments around the preview section.
 */
export const lintJavascriptDemoFocus = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require demo files to have @focus-start / @focus-end comments around the preview section.',
    },
    fixable: 'code',
    messages: {
      missingDemoFocusJsx:
        'Demo file is missing {/* @focus-start */} and {/* @focus-end */} comments around the preview section. Run with --fix to add them automatically.',
      missingDemoFocusJsxSingle:
        'Demo file is missing {/* @focus */} comment on the preview line. Run with --fix to add it automatically.',
      missingDemoFocusJs:
        'Demo file is missing // @focus-start and // @focus-end comments around the preview section. Run with --fix to add them automatically.',
      missingDemoFocusJsSingle:
        'Demo file is missing // @focus comment on the preview line. Run with --fix to add it automatically.',
      missingDemoFocusBody:
        'Demo file is missing // @focus-start @padding 1 and // @focus-end comments around the function body. Run with --fix to add them automatically.',
    } as const,
    schema: [
      {
        type: 'object',
        properties: {
          wrapReturn: {
            type: 'boolean',
            description:
              'When true, bare return statements without parentheses are wrapped in return (...) and the highlight comment is placed inside the parentheses.',
          },
        },
        additionalProperties: false,
      },
    ],
  } as const,
  create(context) {
    const sourceCode = context.sourceCode;

    const options = (context.options[0] ?? {}) as { wrapReturn?: boolean };

    // Skip files that already have @focus directives in comments — those files
    // already control which region the viewer scrolls to.  Files with only
    // @highlight are *not* skipped so the rule can still add @focus for the
    // preview area.
    // We check actual parsed comments (not raw source text) to avoid false
    // negatives from tokens appearing in string literals or identifiers.
    // We use includes('@focus') rather than startsWith because @focus can
    // appear as a modifier on @highlight-start (e.g. "@highlight-start @focus").
    const hasFocusComment = sourceCode.getAllComments().some((comment) => {
      return comment.value.includes('@focus');
    });

    if (hasFocusComment) {
      return {};
    }

    function processFunctionNode(declaration: FunctionLikeNode): void {
      const implicitReturn = getImplicitReturn(declaration);
      if (implicitReturn) {
        const result = getPreviewNodes(implicitReturn);
        if (result) {
          reportPreview(context, sourceCode, result, null, options);
        }
        return;
      }

      const body = getFunctionBody(declaration);
      if (!body || body.length === 0) {
        return;
      }

      // If the body has more than just a return (e.g. hooks, variables),
      // highlight the entire function body
      const hasSetupStatements = body.length > 1 || body[0].type !== 'ReturnStatement';
      if (hasSetupStatements) {
        const firstStatement = body[0];
        const lastStatement = body[body.length - 1];
        reportFunctionBody(context, sourceCode, firstStatement, lastStatement);
        return;
      }

      const lastReturn = body[0] as Node & { argument: Node | null };
      if (!lastReturn.argument) {
        return;
      }

      const result = getPreviewNodes(lastReturn.argument);
      if (result) {
        reportPreview(context, sourceCode, result, lastReturn, options);
      }
    }

    let handled = false;
    const namedExportFunctions: NamedExportFunction[] = [];

    return {
      ExportDefaultDeclaration(node: ExportDefaultDeclaration & Rule.NodeParentExtension) {
        handled = true;
        const inner = unwrapCallExpression(node.declaration as Node);
        processFunctionNode(inner ?? node.declaration);
      },

      ExportNamedDeclaration(node: ExportNamedDeclaration & Rule.NodeParentExtension) {
        const { declaration } = node;
        if (!declaration) {
          return;
        }
        if (declaration.type === 'FunctionDeclaration') {
          namedExportFunctions.push({ name: getFunctionName(declaration), node: declaration });
          return;
        }
        // Handle `export const Demo = () => ...`, `export const Demo = function() ...`,
        // and call-wrapped patterns like `export const Demo = React.forwardRef(function() ...)`
        if (declaration.type === 'VariableDeclaration') {
          for (const declarator of declaration.declarations) {
            if (declarator.init) {
              const inner = unwrapCallExpression(declarator.init);
              if (inner) {
                const name = declarator.id.type === 'Identifier' ? declarator.id.name : null;
                namedExportFunctions.push({ name, node: inner });
              }
            }
          }
        }
      },

      'Program:exit'() {
        if (handled || namedExportFunctions.length === 0) {
          return;
        }

        const base = context.filename.split('/').pop() ?? context.filename;
        const filename = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;

        // Strategy 1: find an exported function whose name matches the filename
        const filenameMatch = namedExportFunctions.find((fn) => fn.name === filename);
        if (filenameMatch) {
          processFunctionNode(filenameMatch.node);
          return;
        }

        // Strategy 2: if there's exactly one exported function, use it
        if (namedExportFunctions.length === 1) {
          processFunctionNode(namedExportFunctions[0].node);
        }
      },
    };
  },
} satisfies Rule.RuleModule;

function reportPreview(
  context: Rule.RuleContext,
  sourceCode: Rule.RuleContext['sourceCode'],
  { nodes: previewNodes, insideWrapper }: PreviewResult,
  returnStatement: Node | null,
  options: { wrapReturn?: boolean },
): void {
  const firstNode = previewNodes[0];
  const lastNode = previewNodes[previewNodes.length - 1];
  const isSingleLine = firstNode.loc.start.line === lastNode.loc.end.line;

  const firstLine = sourceCode.lines[firstNode.loc.start.line - 1];
  const indentation = firstLine.match(/^\s*/)?.[0] ?? '';

  let messageId: string;
  if (insideWrapper) {
    messageId = isSingleLine ? 'missingDemoFocusJsxSingle' : 'missingDemoFocusJsx';
  } else {
    messageId = isSingleLine ? 'missingDemoFocusJsSingle' : 'missingDemoFocusJs';
  }

  context.report({
    loc: {
      start: firstNode.loc.start,
      end: lastNode.loc.end,
    },
    messageId,
    fix(fixer) {
      if (insideWrapper && isSingleLine) {
        return fixer.insertTextBeforeRange(firstNode.range, `{/* @focus */}\n${indentation}`);
      }
      if (insideWrapper) {
        return [
          fixer.insertTextBeforeRange(firstNode.range, `{/* @focus-start */}\n${indentation}`),
          fixer.insertTextAfterRange(lastNode.range, `\n${indentation}{/* @focus-end */}`),
        ];
      }

      // Non-wrapper: wrapReturn wraps bare `return <X>` in `return (\n  // comment\n  <X>\n)`
      if (options.wrapReturn && returnStatement) {
        const hasParens = hasReturnParens(sourceCode, returnStatement);

        if (hasParens) {
          // Already `return (...)` — just insert the comment inside
          const lineStartOffset = sourceCode.getIndexFromLoc({
            line: firstNode.loc.start.line,
            column: 0,
          });
          if (isSingleLine) {
            return fixer.insertTextBeforeRange(
              [lineStartOffset, lineStartOffset],
              `${indentation}// @focus\n`,
            );
          }
          const lastLineStartOffset = sourceCode.getIndexFromLoc({
            line: lastNode.loc.end.line,
            column: 0,
          });
          const lastLine = sourceCode.lines[lastNode.loc.end.line - 1];
          const lastIndentation = lastLine.match(/^\s*/)?.[0] ?? '';
          return [
            fixer.insertTextBeforeRange(
              [lineStartOffset, lineStartOffset],
              `${indentation}// @focus-start\n`,
            ),
            fixer.insertTextAfterRange(
              [lastLineStartOffset, lastLineStartOffset + lastLine.length],
              `\n${lastIndentation}// @focus-end`,
            ),
          ];
        }

        // No parens — wrap `return <X>` into `return (\n  // comment\n  <X>\n)`
        const returnKeywordEnd = returnStatement.range![0] + 'return'.length;
        const returnIndentation =
          sourceCode.lines[returnStatement.loc!.start.line - 1].match(/^\s*/)?.[0] ?? '';
        const innerIndentation = `${returnIndentation}  `;

        if (isSingleLine) {
          return [
            fixer.replaceTextRange(
              [returnKeywordEnd, firstNode.range[0]],
              ` (\n${innerIndentation}// @focus\n${innerIndentation}`,
            ),
            fixer.insertTextAfterRange(lastNode.range, `\n${returnIndentation})`),
          ];
        }
        return [
          fixer.replaceTextRange(
            [returnKeywordEnd, firstNode.range[0]],
            ` (\n${innerIndentation}// @focus-start\n${innerIndentation}`,
          ),
          fixer.insertTextAfterRange(
            lastNode.range,
            `\n${innerIndentation}// @focus-end\n${returnIndentation})`,
          ),
        ];
      }

      // Default non-wrapper: insert JS comment at the start of the line
      const lineStartOffset = sourceCode.getIndexFromLoc({
        line: firstNode.loc.start.line,
        column: 0,
      });
      if (isSingleLine) {
        return fixer.insertTextBeforeRange(
          [lineStartOffset, lineStartOffset],
          `${indentation}// @focus\n`,
        );
      }
      const lastLineStartOffset = sourceCode.getIndexFromLoc({
        line: lastNode.loc.end.line,
        column: 0,
      });
      const lastLine = sourceCode.lines[lastNode.loc.end.line - 1];
      const lastIndentation = lastLine.match(/^\s*/)?.[0] ?? '';
      return [
        fixer.insertTextBeforeRange(
          [lineStartOffset, lineStartOffset],
          `${indentation}// @focus-start\n`,
        ),
        fixer.insertTextAfterRange(
          [lastLineStartOffset, lastLineStartOffset + lastLine.length],
          `\n${lastIndentation}// @focus-end`,
        ),
      ];
    },
  });
}

/**
 * Checks whether a return statement's argument is wrapped in parentheses.
 */
function hasReturnParens(
  sourceCode: Rule.RuleContext['sourceCode'],
  returnStatement: Node,
): boolean {
  const text = sourceCode.getText(returnStatement as Rule.Node);
  const afterReturn = text.slice('return'.length).trimStart();
  return afterReturn.startsWith('(');
}

/**
 * Reports when the entire function body should be highlighted (e.g. when there are hooks/setup).
 */
function reportFunctionBody(
  context: Rule.RuleContext,
  sourceCode: Rule.RuleContext['sourceCode'],
  firstStatement: Node,
  lastStatement: Node,
): void {
  const firstLine = sourceCode.lines[firstStatement.loc!.start.line - 1];
  const indentation = firstLine.match(/^\s*/)?.[0] ?? '';

  const lastLine = sourceCode.lines[lastStatement.loc!.end.line - 1];
  const lastIndentation = lastLine.match(/^\s*/)?.[0] ?? '';

  const lineStartOffset = sourceCode.getIndexFromLoc({
    line: firstStatement.loc!.start.line,
    column: 0,
  });
  const lastLineStartOffset = sourceCode.getIndexFromLoc({
    line: lastStatement.loc!.end.line,
    column: 0,
  });

  context.report({
    loc: {
      start: firstStatement.loc!.start,
      end: lastStatement.loc!.end,
    },
    messageId: 'missingDemoFocusBody',
    fix(fixer) {
      return [
        fixer.insertTextBeforeRange(
          [lineStartOffset, lineStartOffset],
          `${indentation}// @focus-start @padding 1\n`,
        ),
        fixer.insertTextAfterRange(
          [lastLineStartOffset, lastLineStartOffset + lastLine.length],
          `\n${lastIndentation}// @focus-end`,
        ),
      ];
    },
  });
}
