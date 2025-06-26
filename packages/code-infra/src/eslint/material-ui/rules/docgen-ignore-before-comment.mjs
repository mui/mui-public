export default /** @type {import('eslint').Rule.RuleModule} */ ({
  meta: {
    messages: {
      ignoreBeforeComment: '@ignore should be at the beginning of a block comment.',
    },
  },
  create: (context) => {
    const { sourceCode } = context;
    sourceCode.getAllComments().forEach((comment) => {
      if (comment.type !== 'Block') {
        return;
      }

      /**
       * The regex has 5 groups (mostly for readability) that match:
       *   1. '/**',
       *   2. One or more comment lines beginning with '*',
       *   3. '* @ignore',
       *   4. Any number of comment lines beginning with '*',
       *   5. '* /' (without the space).
       *
       *   All lines can begin with any number of spaces.
       */
      if (comment.value.match(/( *\*\n)( *\*.*\n)+( *\* @ignore\n)( *\*.*\n)*( )/)) {
        context.report({
          node: comment,
          messageId: 'ignoreBeforeComment',
        });
      }
    });

    return {};
  },
});
