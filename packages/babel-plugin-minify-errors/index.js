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
 * @typedef {'annotate' | 'throw' | 'write'} MissingError
 * @typedef {babel.PluginPass & {formatErrorMessageIdentifier?: babel.types.Identifier, processedNodes?: WeakSet<babel.types.Node>}} PluginState
 * @typedef {{
 *   errorCodesPath?: string,
 *   runtimeModule?: string,
 *   detection?: 'opt-in' | 'opt-out',
 *   outExtension?: string,
 *   collectErrors?: Set<string | Error>
 * }} Options
 */

/**
 * `collectErrors` - When provided, the plugin collects error messages into this Set
 * instead of transforming the code. The caller typically passes the same Set instance
 * across multiple plugin invocations (e.g., when processing multiple files), and the
 * plugin is expected to mutate the Set by adding entries during traversal.
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
 * @typedef {{ path: babel.NodePath<babel.types.Expression>, message: string, expressions: babel.types.Expression[] }} ExtractedMessage
 */

/**
 * Extracts the message and expressions from a path.
 * @param {babel.types} t
 * @param {babel.NodePath<babel.types.ArgumentPlaceholder | babel.types.SpreadElement | babel.types.Expression>} path
 * @returns {ExtractedMessage | null}
 */
function extractMessage(t, path) {
  if (path.isSpreadElement() || path.isArgumentPlaceholder()) {
    return null;
  }
  if (path.isTemplateLiteral()) {
    return {
      path,
      message: path.node.quasis.map((quasi) => quasi.value.cooked).join('%s'),
      expressions: path.node.expressions.map((expression) => {
        if (t.isExpression(expression)) {
          return expression;
        }
        throw path.buildCodeFrameError('Can only evaluate javascript template literals.');
      }),
    };
  }
  if (path.isStringLiteral()) {
    return { path, message: path.node.value, expressions: [] };
  }
  if (path.isBinaryExpression() && path.node.operator === '+') {
    const leftPath = path.get('left');
    if (leftPath.isExpression()) {
      const left = extractMessage(t, leftPath);
      const right = extractMessage(t, path.get('right'));
      if (!left || !right) {
        return null;
      }
      return {
        path,
        message: left.message + right.message,
        expressions: [...left.expressions, ...right.expressions],
      };
    }
  }
  return null;
}

/**
 * @param {babel.types} t
 * @param {babel.NodePath<babel.types.NewExpression>} newExpressionPath
 * @param {'opt-in' | 'opt-out'} detection
 * @returns {null | babel.NodePath<babel.types.ArgumentPlaceholder | babel.types.SpreadElement | babel.types.Expression>}
 */
function findMessageNode(t, newExpressionPath, detection) {
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
      break;
    }
    case 'opt-out': {
      if (
        newExpressionPath.node.leadingComments?.some((comment) =>
          comment.value.includes(COMMENT_OPT_OUT_MARKER),
        )
      ) {
        return null;
      }

      break;
    }
    default: {
      throw new Error(`Unknown detection option: ${detection}`);
    }
  }

  const messagePath = newExpressionPath.get('arguments')[0];

  return messagePath ?? null;
}

/**
 * Transforms the error message node.
 * @param {babel.types} t
 * @param {ExtractedMessage} extracted
 * @param {number} errorCode
 * @param {PluginState} state
 * @param {string} runtimeModule
 * @param {string} outExtension
 * @returns {babel.types.Expression}
 */
function transformMessage(t, extracted, errorCode, state, runtimeModule, outExtension) {
  if (!state.formatErrorMessageIdentifier) {
    state.formatErrorMessageIdentifier = helperModuleImports.addDefault(
      extracted.path,
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
    extracted.path.node,
    t.callExpression(t.cloneNode(state.formatErrorMessageIdentifier, true), [
      t.numericLiteral(errorCode),
      ...extracted.expressions,
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
    runtimeModule = '#formatErrorMessage',
    detection = 'opt-in',
    outExtension = '.js',
    collectErrors,
  },
) {
  /** @type {Map<string, number>} */
  let errorCodesLookup;

  if (collectErrors) {
    errorCodesLookup = new Map();
  } else {
    if (!errorCodesPath) {
      throw new Error('errorCodesPath is required.');
    }

    const errorCodesContent = fs.readFileSync(errorCodesPath, 'utf8');
    const errorCodes = JSON.parse(errorCodesContent);

    errorCodesLookup = new Map(
      Object.entries(errorCodes).map(([key, value]) => [value, Number(key)]),
    );
  }

  return {
    name: '@mui/internal-babel-plugin-minify-errors',
    visitor: {
      NewExpression(newExpressionPath, state) {
        // Initialize the WeakSet lazily to track processed nodes
        state.processedNodes ??= new WeakSet();

        // Skip if we've already processed this node. This can happen when Babel
        // visits the same node multiple times due to configuration or plugin
        // interactions (e.g., @babel/preset-env with modules: 'commonjs' combined
        // with React.forwardRef causes double visitation).
        if (state.processedNodes.has(newExpressionPath.node)) {
          return;
        }

        // Mark this node as processed before transforming
        state.processedNodes.add(newExpressionPath.node);

        const messagePath = findMessageNode(t, newExpressionPath, detection);

        if (!messagePath) {
          // Not an error, or not eligible for minification
          return;
        }

        if (!collectErrors && newExpressionPath.node.leadingComments) {
          newExpressionPath.node.leadingComments = newExpressionPath.node.leadingComments.filter(
            (comment) =>
              !comment.value.includes(COMMENT_OPT_IN_MARKER) &&
              !comment.value.includes(COMMENT_OPT_OUT_MARKER),
          );
        }

        const extracted = extractMessage(t, messagePath);

        if (!extracted) {
          if (collectErrors) {
            // Mutates the caller's Set
            collectErrors.add(
              messagePath.buildCodeFrameError(
                'Unminifyable error. You can only use literal strings and template strings as error messages.',
              ),
            );
          } else {
            newExpressionPath.addComment(
              'leading',
              ' FIXME (minify-errors-in-prod): Unminifyable error in production! ',
            );
          }
          return;
        }

        const errorCode = errorCodesLookup.get(extracted.message);

        if (collectErrors) {
          // Mutates the caller's Set
          collectErrors.add(extracted.message);
          return;
        }

        if (errorCode === undefined) {
          newExpressionPath.addComment(
            'leading',
            ' FIXME (minify-errors-in-prod): Unminified error message in production build! ',
          );
          return;
        }

        const transformedMessage = transformMessage(
          t,
          extracted,
          errorCode,
          state,
          runtimeModule,
          outExtension,
        );

        messagePath.replaceWith(transformedMessage);
      },
    },
  };
};
