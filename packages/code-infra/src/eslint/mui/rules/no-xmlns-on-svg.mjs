/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    docs: {
      description: 'Disallow xmlns attribute on inline <svg> elements in JSX.',
    },
    messages: {
      xmlnsOnSvg:
        'Remove xmlns from inline <svg>. The attribute is redundant in HTML and adds unnecessary bytes.',
    },
    type: 'suggestion',
    fixable: 'code',
    schema: [],
  },
  create(context) {
    return {
      // xmlns="http://www.w3.org/2000/svg" is only needed on standalone .svg files so the
      // browser treats them as SVG instead of generic XML. Inside HTML the <svg> element is
      // already recognised by the browser, so the attribute is dead weight.
      // https://github.com/mui/mui-public/pull/1321
      'JSXOpeningElement[name.name="svg"] > JSXAttribute[name.name="xmlns"]'(
        /** @type {import('estree-jsx').JSXAttribute} */ node,
      ) {
        context.report({
          node,
          messageId: 'xmlnsOnSvg',
          fix(fixer) {
            const tokenBefore = context.sourceCode.getTokenBefore(node);
            const start = tokenBefore ? tokenBefore.range[1] : /** @type {[number, number]} */ (node.range)[0];
            return fixer.removeRange([start, /** @type {[number, number]} */ (node.range)[1]]);
          },
        });
      },
    };
  },
};

export default rule;
