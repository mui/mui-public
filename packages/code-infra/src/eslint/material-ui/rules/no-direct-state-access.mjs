/**
 *
 * @param {import('@typescript-eslint/utils').TSESTree.Expression | import('@typescript-eslint/utils').TSESTree.Super | null | undefined} maybeMemberExpression
 * @param {string} propertyName
 * @returns {import('@typescript-eslint/utils').TSESTree.Expression | import('@typescript-eslint/utils').TSESTree.Super | null | undefined}
 */
function checkIsAccessingMember(maybeMemberExpression, propertyName) {
  if (!maybeMemberExpression) {
    return undefined;
  }
  if (maybeMemberExpression.type === 'MemberExpression') {
    const property = maybeMemberExpression.property;
    if (property.type === 'Identifier' && property.name === propertyName) {
      return maybeMemberExpression.object;
    }
  }
  return undefined;
}

/**
 * @param {import('@typescript-eslint/utils').TSESTree.MemberExpression} node
 * @param {import('@typescript-eslint/utils').TSESLint.RuleContext<any, any>} context
 * @param {import('@typescript-eslint/utils').TSESTree.Expression | import('@typescript-eslint/utils').TSESTree.VariableDeclarator} nodeToReport
 * @returns
 */
function reportIfDirectlyAccessingState(node, context, nodeToReport = node) {
  const maybeApiRef = checkIsAccessingMember(checkIsAccessingMember(node, 'state'), 'current');

  if (!maybeApiRef || (maybeApiRef && maybeApiRef.type !== 'Identifier')) {
    return;
  }

  const { parserServices } = context.sourceCode;
  // @ts-expect-error FIXME: Code wrongly assumes that parserServices is available
  const checker = parserServices.program.getTypeChecker();
  // @ts-expect-error FIXME: Code wrongly assumes that parserServices is available
  const originalNode = parserServices.esTreeNodeToTSNodeMap.get(maybeApiRef);
  const nodeType = checker.getTypeAtLocation(originalNode);

  if (nodeType.aliasSymbol && nodeType.aliasSymbol.escapedName === 'GridApiRef') {
    context.report({ node: nodeToReport, messageId: 'direct-access' });
  }
}

/**
 * @type {import('@typescript-eslint/utils').TSESLint.AnyRuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    messages: {
      'direct-access': "Don't access directly state values. Prefer a selector.",
    },
    schema: [],
  },
  defaultOptions: [],
  create: (context) => {
    return {
      // Checks `const rows = apiRef.current.state.rows;`
      MemberExpression(node) {
        // We can ignore the rightmost path since it doesn't make difference.
        // We're only interested in the nodes after it.
        // apiRef.current.state.rows
        // ^^^^^^^^^^^^^^^^^^^^
        if (node.parent && node.parent.type === 'MemberExpression') {
          reportIfDirectlyAccessingState(node, context);
        }
      },
      // Checks `const { rows } = apiRef.current.state;`
      VariableDeclarator(node) {
        // Ensure that the variable id is of form `const { foo } = obj;`
        if (node.id.type === 'ObjectPattern') {
          if (node.init?.type === 'MemberExpression') {
            reportIfDirectlyAccessingState(node.init, context, node);
          }
        }
      },
    };
  },
};

export default rule;
