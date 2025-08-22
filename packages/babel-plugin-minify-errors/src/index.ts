import * as helperModuleImports from '@babel/helper-module-imports';
import * as babel from '@babel/core';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import finder from 'find-package-json';

/**
 * Normalize a file path to POSIX in order for it to be platform-agnostic.
 */
function toPosixPath(importPath: string): string {
  return nodePath.normalize(importPath).split(nodePath.sep).join(nodePath.posix.sep);
}

/**
 * Converts a file path to a node import specifier.
 */
function pathToNodeImportSpecifier(importPath: string): string {
  const normalized = toPosixPath(importPath);
  return normalized.startsWith('/') || normalized.startsWith('.') ? normalized : `./${normalized}`;
}

const COMMENT_OPT_IN_MARKER = 'minify-error';
const COMMENT_OPT_OUT_MARKER = 'minify-error-disabled';

export interface PluginState extends babel.PluginPass {
  updatedErrorCodes?: boolean;
  formatErrorMessageIdentifier?: babel.types.Identifier;
}

export type MissingError = 'annotate' | 'throw' | 'write';

export interface Options {
  errorCodesPath: string;
  missingError?: MissingError;
  runtimeModule?: string;
  detection?: 'opt-in' | 'opt-out';
  outExtension?: string;
}

interface ExtractedMessage {
  message: string;
  expressions: babel.types.Expression[];
}

/**
 * Extracts the message and expressions from a node.
 */
function extractMessage(t: typeof babel.types, node: babel.types.Node): ExtractedMessage | null {
  if (t.isTemplateLiteral(node)) {
    return {
      message: node.quasis.map((quasi) => quasi.value.cooked).join('%s'),
      expressions: node.expressions.map((expression) => {
        if (t.isExpression(expression)) {
          return expression;
        }
        throw new Error('Can only evaluate javascript template literals.');
      }),
    };
  }
  if (t.isStringLiteral(node)) {
    return { message: node.value, expressions: [] };
  }
  if (t.isBinaryExpression(node) && node.operator === '+') {
    const left = extractMessage(t, node.left);
    const right = extractMessage(t, node.right);
    if (!left || !right) {
      return null;
    }
    return {
      message: left.message + right.message,
      expressions: [...left.expressions, ...right.expressions],
    };
  }
  return null;
}

/**
 * Handles unminifyable errors based on the missingError option.
 */
function handleUnminifyableError(missingError: MissingError, path: babel.NodePath): void {
  switch (missingError) {
    case 'annotate':
      path.addComment(
        'leading',
        ' FIXME (minify-errors-in-prod): Unminifyable error in production! ',
      );
      break;
    case 'throw':
      throw new Error(
        'Unminifyable error. You can only use literal strings and template strings as error messages.',
      );
    case 'write':
      break;
    default:
      throw new Error(`Unknown missingError option: ${missingError}`);
  }
}

/**
 * Transforms the error message node.
 */
function transformMessage(
  t: typeof babel.types,
  path: babel.NodePath,
  messageNode: babel.types.Expression,
  state: PluginState,
  errorCodesLookup: Map<string, number>,
  missingError: MissingError,
  runtimeModule: string,
  outExtension: string,
): babel.types.Expression | null {
  const message = extractMessage(t, messageNode);
  if (!message) {
    handleUnminifyableError(missingError, path);
    return null;
  }

  let errorCode = errorCodesLookup.get(message.message);
  if (errorCode === undefined) {
    switch (missingError) {
      case 'annotate':
        path.addComment(
          'leading',
          ' FIXME (minify-errors-in-prod): Unminified error message in production build! ',
        );
        return null;
      case 'throw':
        throw new Error(
          `Missing error code for message '${message.message}'. Did you forget to run \`pnpm extract-error-codes\` first?`,
        );
      case 'write':
        errorCode = errorCodesLookup.size + 1;
        errorCodesLookup.set(message.message, errorCode);
        state.updatedErrorCodes = true;
        break;
      default:
        throw new Error(`Unknown missingError option: ${missingError}`);
    }
  }

  if (!state.formatErrorMessageIdentifier) {
    state.formatErrorMessageIdentifier = helperModuleImports.addDefault(
      path,
      transformExtension(resolveRuntimeModule(runtimeModule, state), outExtension),
      { nameHint: '_formatErrorMessage' },
    );
  }

  return t.conditionalExpression(
    t.binaryExpression(
      '!==',
      t.memberExpression(
        t.memberExpression(t.identifier('process'), t.identifier('env')),
        t.identifier('NODE_ENV'),
      ),
      t.stringLiteral('production'),
    ),
    messageNode,
    t.callExpression(t.cloneNode(state.formatErrorMessageIdentifier, true), [
      t.numericLiteral(errorCode),
      ...message.expressions,
    ]),
  );
}

/**
 * Resolves the runtime module path recursively.
 */
function resolveRuntimeModule(
  runtimeModule: string,
  state: PluginState,
  visitedModules = new Set<string>(),
): string {
  if (!runtimeModule.startsWith('#')) {
    return runtimeModule;
  }

  const currentFile = state.filename;
  if (!currentFile) {
    throw new Error('filename is not defined');
  }

  const result = finder(currentFile).next();
  if (result.done) {
    throw new Error('Could not find package.json');
  }

  const pkg = result.value;
  const pkgPath = result.filename;
  const runtimeModulePath = pkg?.imports?.[runtimeModule];
  if (typeof runtimeModulePath !== 'string') {
    throw new Error(`Invalid runtime module path for ${runtimeModule}`);
  }

  if (visitedModules.has(runtimeModule)) {
    throw new Error(`Circular import detected for ${runtimeModule}`);
  }
  visitedModules.add(runtimeModule);

  if (runtimeModulePath.startsWith('.')) {
    const resolvedPath = nodePath.resolve(nodePath.dirname(pkgPath), runtimeModulePath);
    const relativePath = nodePath.relative(nodePath.dirname(currentFile), resolvedPath);
    return pathToNodeImportSpecifier(relativePath);
  }

  return resolveRuntimeModule(runtimeModulePath, state, visitedModules);
}

/**
 * Transform file extension of import specifier.
 */
function transformExtension(importSpecifier: string, outExtension = '.js'): string {
  return importSpecifier.replace(/\.[a-zA-Z0-9]+$/, outExtension);
}

/**
 * Babel plugin for minifying error messages.
 */
export default function plugin(
  { types: t }: typeof babel,
  {
    errorCodesPath,
    missingError = 'annotate',
    runtimeModule = '#formatErrorMessage',
    detection = 'opt-in',
    outExtension = '.js',
  }: Options,
): babel.PluginObj<PluginState> {
  if (!errorCodesPath) {
    throw new Error('errorCodesPath is required.');
  }

  const errorCodesContent = fs.readFileSync(errorCodesPath, 'utf8');
  const errorCodes = JSON.parse(errorCodesContent) as Record<string, string>;

  const errorCodesLookup = new Map(
    Object.entries(errorCodes).map(([key, value]) => [value, Number(key)]),
  );

  return {
    name: '@mui/internal-babel-plugin-minify-errors',
    visitor: {
      NewExpression(
        newExpressionPath: babel.NodePath<babel.types.NewExpression>,
        state: PluginState,
      ) {
        if (!newExpressionPath.get('callee').isIdentifier({ name: 'Error' })) {
          return;
        }

        switch (detection) {
          case 'opt-in': {
            if (
              !newExpressionPath.node.leadingComments?.some((comment) =>
                comment.value.includes(COMMENT_OPT_IN_MARKER),
              )
            ) {
              return;
            }
            newExpressionPath.node.leadingComments = newExpressionPath.node.leadingComments.filter(
              (comment) => !comment.value.includes(COMMENT_OPT_IN_MARKER),
            );
            break;
          }
          case 'opt-out': {
            if (
              newExpressionPath.node.leadingComments?.some((comment) =>
                comment.value.includes(COMMENT_OPT_OUT_MARKER),
              )
            ) {
              newExpressionPath.node.leadingComments =
                newExpressionPath.node.leadingComments.filter(
                  (comment) => !comment.value.includes(COMMENT_OPT_OUT_MARKER),
                );
              return;
            }

            break;
          }
          default: {
            throw new Error(`Unknown detection option: ${detection}`);
          }
        }

        const messagePath = newExpressionPath.get('arguments')[0];
        if (!messagePath) {
          return;
        }

        const messageNode = messagePath.node;
        if (t.isSpreadElement(messageNode) || t.isArgumentPlaceholder(messageNode)) {
          handleUnminifyableError(missingError, newExpressionPath);
          return;
        }

        const transformedMessage = transformMessage(
          t,
          newExpressionPath,
          messageNode,
          state,
          errorCodesLookup,
          missingError,
          runtimeModule,
          outExtension,
        );

        if (transformedMessage) {
          messagePath.replaceWith(transformedMessage);
        }
      },
    },
    post() {
      if (missingError === 'write' && this.updatedErrorCodes) {
        const invertedErrorCodes = Object.fromEntries(
          Array.from(errorCodesLookup, ([key, value]) => [value, key]),
        );
        fs.writeFileSync(errorCodesPath, `${JSON.stringify(invertedErrorCodes, null, 2)}\n`);
      }
    },
  };
}
