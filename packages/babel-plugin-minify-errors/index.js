// @ts-check

const helperModuleImports = require('@babel/helper-module-imports');
const fs = require('fs');
const nodePath = require('path');
const finder = require('find-package-json');

/**
 * Normalize a file path to POSIX in order for it to be platform-agnostic.
 * @param {string} importPath
 * @returns {string}
 */
function toPosixPath(importPath) {
  return nodePath.normalize(importPath).split(nodePath.sep).join(nodePath.posix.sep);
}

/**
 * Converts a file path to a node import specifier.
 * @param {string} importPath
 * @returns {string}
 */
function pathToNodeImportSpecifier(importPath) {
  const normalized = toPosixPath(importPath);
  return normalized.startsWith('/') || normalized.startsWith('.') ? normalized : `./${normalized}`;
}

const COMMENT_OPT_IN_MARKER = 'minify-error';
const COMMENT_OPT_OUT_MARKER = 'minify-error-disabled';
const SUPPORTED_ERROR_CONSTRUCTORS = new Set(['Error', 'TypeError']);

/**
 * @typedef {import('@babel/core')} babel
 */

/**
 * @typedef {babel.PluginPass & {updatedErrorCodes?: boolean, formatErrorMessageIdentifier?: babel.types.Identifier}} PluginState
 * @typedef {'annotate' | 'throw' | 'write'} MissingError
 * @typedef {{
 *   errorCodesPath: string,
 *   missingError: MissingError,
 *   runtimeModule?: string,
 *   detection?: 'opt-in' | 'opt-out',
 *   outExtension?: string
 * }} Options
 */

/**
 * Checks if a node is `process.env.NODE_ENV` using Babel types.
 * @param {babel.types} t
 * @param {babel.types.Node} node
 * @returns {boolean}
 */
function isProcessEnvNodeEnv(t, node) {
  return (
    t.isMemberExpression(node) &&
    t.isMemberExpression(node.object) &&
    t.isIdentifier(node.object.object, { name: 'process' }) &&
    t.isIdentifier(node.object.property, { name: 'env' }) &&
    t.isIdentifier(node.property, { name: 'NODE_ENV' })
  );
}

/**
 * Checks if a binary expression compares `process.env.NODE_ENV` with a value using the given operator.
 * Handles both `process.env.NODE_ENV op value` and `value op process.env.NODE_ENV`.
 * @param {babel.types} t
 * @param {babel.types.BinaryExpression} node
 * @param {string} operator
 * @param {string} value
 * @returns {boolean}
 */
function isNodeEnvComparison(t, node, operator, value) {
  if (node.operator !== operator) {
    return false;
  }
  return (
    (isProcessEnvNodeEnv(t, node.left) && t.isStringLiteral(node.right, { value })) ||
    (t.isStringLiteral(node.left, { value }) && isProcessEnvNodeEnv(t, node.right))
  );
}

/**
 * Checks if the given path is inside a dev-only branch
 * (e.g. `if (process.env.NODE_ENV !== 'production') { ... }`).
 * Errors inside such branches are already stripped in production,
 * so minification is unnecessary.
 * @param {babel.types} t
 * @param {babel.NodePath} path
 * @returns {boolean}
 */
function isInsideDevOnlyBranch(t, path) {
  let current = path;
  while (current.parentPath) {
    const parent = current.parentPath;
    if (parent.isIfStatement()) {
      const isInConsequent = current.key === 'consequent';
      const isInAlternate = current.key === 'alternate';
      if ((isInConsequent || isInAlternate) && t.isBinaryExpression(parent.node.test)) {
        const operator = isInConsequent ? '!==' : '===';
        if (isNodeEnvComparison(t, parent.node.test, operator, 'production')) {
          return true;
        }
      }
    }
    current = current.parentPath;
  }
  return false;
}

/**
 * Extracts the message and expressions from a node.
 * @param {babel.types} t
 * @param {babel.types.Node} node
 * @returns {{ message: string, expressions: babel.types.Expression[] } | null}
 */
function extractMessage(t, node) {
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
 * @param {MissingError} missingError
 * @param {babel.NodePath} path
 */
function handleUnminifyableError(missingError, path) {
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
 * @param {babel.types} t
 * @param {babel.NodePath<babel.types.NewExpression>} newExpressionPath
 * @param {{ detection: Options['detection']; missingError: MissingError}} param2
 * @returns {null | { messageNode: babel.types.Expression; messagePath: babel.NodePath<babel.types.ArgumentPlaceholder | babel.types.SpreadElement | babel.types.Expression>; message: { message: string; expressions: babel.types.Expression[] } }}
 */
function findMessageNode(t, newExpressionPath, { detection, missingError }) {
  const callee = newExpressionPath.get('callee');
  if (!callee.isIdentifier() || !SUPPORTED_ERROR_CONSTRUCTORS.has(callee.node.name)) {
    return null;
  }

  if (isInsideDevOnlyBranch(t, newExpressionPath)) {
    return null;
  }

  switch (detection) {
    case 'opt-in': {
      if (
        !newExpressionPath.node.leadingComments?.some((comment) =>
          comment.value.includes(COMMENT_OPT_IN_MARKER),
        )
      ) {
        return null;
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
        newExpressionPath.node.leadingComments = newExpressionPath.node.leadingComments.filter(
          (comment) => !comment.value.includes(COMMENT_OPT_OUT_MARKER),
        );
        return null;
      }

      break;
    }
    default: {
      throw new Error(`Unknown detection option: ${detection}`);
    }
  }

  const messagePath = newExpressionPath.get('arguments')[0];
  if (!messagePath) {
    return null;
  }

  const messageNode = messagePath.node;
  if (t.isSpreadElement(messageNode) || t.isArgumentPlaceholder(messageNode)) {
    handleUnminifyableError(missingError, newExpressionPath);
    return null;
  }
  const message = extractMessage(t, messageNode);
  if (!message) {
    handleUnminifyableError(missingError, newExpressionPath);
    return null;
  }
  return { messagePath, messageNode, message };
}

/**
 * Transforms the error message node.
 * @param {babel.types} t
 * @param {babel.NodePath} path
 * @param {babel.types.Expression} messageNode
 * @param {PluginState} state
 * @param {Map<string, number>} errorCodesLookup
 * @param {MissingError} missingError
 * @param {string} runtimeModule
 * @param {string} outExtension
 * @returns {babel.types.Expression | null}
 */
function transformMessage(
  t,
  path,
  messageNode,
  state,
  errorCodesLookup,
  missingError,
  runtimeModule,
  outExtension,
) {
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
 * @param {string} runtimeModule
 * @param {PluginState} state
 * @param {Set<string>} [visitedModules]
 * @returns {string}
 */
function resolveRuntimeModule(runtimeModule, state, visitedModules = new Set()) {
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
 *
 * @param {string} importSpecifier
 * @param {string} outExtension
 * @returns
 */
function transformExtension(importSpecifier, outExtension = '.js') {
  return importSpecifier.replace(/\.[a-zA-Z0-9]+$/, outExtension);
}

/**
 * @param {babel} file
 * @param {Options} options
 * @returns {babel.PluginObj<PluginState>}
 */
module.exports = function plugin(
  { types: t },
  {
    errorCodesPath,
    missingError = 'annotate',
    runtimeModule = '#formatErrorMessage',
    detection = 'opt-in',
    outExtension = '.js',
  },
) {
  if (!errorCodesPath) {
    throw new Error('errorCodesPath is required.');
  }

  const errorCodesContent = fs.readFileSync(errorCodesPath, 'utf8');
  const errorCodes = JSON.parse(errorCodesContent);

  const errorCodesLookup = new Map(
    Object.entries(errorCodes).map(([key, value]) => [value, Number(key)]),
  );

  return {
    name: '@mui/internal-babel-plugin-minify-errors',
    visitor: {
      NewExpression(newExpressionPath, state) {
        if (isInsideDevOnlyBranch(t, newExpressionPath)) {
          return;
        }

        const message = findMessageNode(t, newExpressionPath, { detection, missingError });
        if (!message) {
          return;
        }

        const transformedMessage = transformMessage(
          t,
          newExpressionPath,
          message.messageNode,
          state,
          errorCodesLookup,
          missingError,
          runtimeModule,
          outExtension,
        );

        if (transformedMessage) {
          message.messagePath.replaceWith(transformedMessage);
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
};

module.exports.findMessageNode = findMessageNode;

exports.findMessageNode = findMessageNode;
