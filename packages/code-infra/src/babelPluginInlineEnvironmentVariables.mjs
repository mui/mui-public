/**
 * Inlines `process.env.X` member expressions with their build-time value.
 *
 * Forked from `babel-plugin-transform-inline-environment-variables` (unmaintained, last
 * published 2022) because it calls the now-removed `NodePath#toComputedKey()` under Babel 8's
 * `@babel/traverse`. Behavior is otherwise identical to the upstream plugin.
 *
 * @param {import('@babel/core').PluginAPI} api
 * @returns {import('@babel/core').PluginObject}
 */
export default function babelPluginInlineEnvironmentVariables({ types: t }) {
  /**
   * @param {import('@babel/core').NodePath<import('@babel/core').types.MemberExpression>} path
   */
  function isLeftSideOfAssignmentExpression(path) {
    return t.isAssignmentExpression(path.parent) && path.parent.left === path.node;
  }

  return {
    name: 'transform-inline-environment-variables',
    visitor: {
      MemberExpression(
        path,
        /** @type {{ opts?: { include?: string[], exclude?: string[] } }} */ {
          opts: { include, exclude } = {},
        },
      ) {
        if (!path.get('object').matchesPattern('process.env')) {
          return;
        }

        const key = t.toComputedKey(path.node);

        if (
          t.isStringLiteral(key) &&
          !isLeftSideOfAssignmentExpression(path) &&
          (!include || include.indexOf(key.value) !== -1) &&
          (!exclude || exclude.indexOf(key.value) === -1)
        ) {
          path.replaceWith(t.valueToNode(process.env[key.value]));
        }
      },
    },
  };
}
