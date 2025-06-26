/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    messages: {
      'keyboard-target':
        "Don't use document.activeElement as a target for keyboard events. Prefer the actual element.",
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @returns {boolean}
     */
    function isDocumentActiveElementNode(node) {
      return (
        node.type === 'MemberExpression' &&
        /** @type {import('estree').MemberExpression} */ (node).object.type === 'Identifier' &&
        /** @type {import('estree').Identifier} */ (
          /** @type {import('estree').MemberExpression} */ (node).object
        ).name === 'document' &&
        /** @type {import('estree').MemberExpression} */ (node).property.type === 'Identifier' &&
        /** @type {import('estree').Identifier} */ (
          /** @type {import('estree').MemberExpression} */ (node).property
        ).name === 'activeElement'
      );
    }

    return {
      CallExpression(node) {
        /** @type {string[]} */
        const keyboardEventDispatchers = ['keyDown', 'keyUp'];
        const {
          arguments: [firstArgument],
          callee,
        } = node;
        const isFireKeyboardEvent =
          callee.type === 'MemberExpression' &&
          /** @type {import('estree').MemberExpression} */ (callee).property.type ===
            'Identifier' &&
          keyboardEventDispatchers.includes(
            /** @type {import('estree').Identifier} */ (
              /** @type {import('estree').MemberExpression} */ (callee).property
            ).name,
          ) &&
          /** @type {import('estree').MemberExpression} */ (callee).object.type === 'Identifier' &&
          /** @type {import('estree').Identifier} */ (
            /** @type {import('estree').MemberExpression} */ (callee).object
          ).name === 'fireEvent';
        const targetsDocumentActiveElement =
          firstArgument !== undefined &&
          (firstArgument.type === 'TSNonNullExpression'
            ? isDocumentActiveElementNode(firstArgument.expression)
            : isDocumentActiveElementNode(firstArgument));

        if (isFireKeyboardEvent && targetsDocumentActiveElement) {
          context.report({ messageId: 'keyboard-target', node: firstArgument });
        }
      },
    };
  },
};

export default rule;
