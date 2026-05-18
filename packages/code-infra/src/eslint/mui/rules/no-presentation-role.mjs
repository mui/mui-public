/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    docs: {
      description:
        'Disallow role="presentation" in favor of role="none". Both are equivalent, but role="none" is clearer and shorter.',
    },
    messages: {
      noPresentation:
        'Use role="none" instead of role="presentation". They are equivalent, but role="none" is preferred.',
    },
    fixable: 'code',
    type: 'suggestion',
    schema: [],
  },
  create(context) {
    return {
      /** @param {import('estree-jsx').JSXAttribute} node */
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'role') {
          return;
        }

        const { value } = node;

        // role="presentation"
        if (value !== null && value.type === 'Literal' && value.value === 'presentation') {
          context.report({
            node,
            messageId: 'noPresentation',
            fix(fixer) {
              return fixer.replaceText(value, '"none"');
            },
          });
          return;
        }

        // role={'presentation'}
        if (
          value !== null &&
          value.type === 'JSXExpressionContainer' &&
          value.expression.type === 'Literal' &&
          value.expression.value === 'presentation'
        ) {
          context.report({
            node,
            messageId: 'noPresentation',
            fix(fixer) {
              return fixer.replaceText(value, '"none"');
            },
          });
        }
      },
    };
  },
};

export default rule;
