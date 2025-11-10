/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    messages: {
      nameMismatch: "Expected `name` to be 'Mui{{ componentName }}' but instead got '{{ name }}'.",
      noComponent: 'Unable to find component for this call.',
      noNameProperty: 'Unable to find `name` property. Did you forget to pass `name`?',
      noNameSecondArgument:
        "Unable to find name argument. Expected `{{ customHook }}(firstParameter, 'MuiComponent')`.",
      noNameValue:
        'Unable to resolve `name`. Please hardcode the `name` i.e. use a string literal.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          customHooks: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [options = {}] = context.options;
    const { customHooks = [] } = options;

    /**
     * Resolves the name literal from the useThemeProps call.
     * @param {import('estree').CallExpression & import('eslint').Rule.NodeParentExtension} node
     */
    function resolveUseThemePropsNameLiteral(node) {
      const firstArg = /** @type {import('estree').ObjectExpression} */ (node.arguments[0]);
      if (!firstArg.properties) {
        return null;
      }
      const nameProperty = firstArg.properties.find(
        (property) =>
          property.type === 'Property' &&
          /** @type {import('estree').Identifier} */ (property.key).name === 'name',
      );
      if (nameProperty === undefined) {
        context.report({
          node: firstArg,
          messageId: 'noNameProperty',
        });
        return null;
      }
      if (nameProperty.type === 'Property' && nameProperty.value.type !== 'Literal') {
        context.report({ node: nameProperty.value, messageId: 'noNameValue' });
        return null;
      }
      return /** @type {import('estree').Property} */ (nameProperty).value;
    }

    /**
     * Resolves the name literal from the useThemeProps call.
     * @param {import('estree').CallExpression & import('eslint').Rule.NodeParentExtension} node
     */
    function resolveCustomHookNameLiteral(node) {
      const secondArgument = node.arguments[1];
      if (secondArgument === undefined) {
        context.report({
          node: node.arguments[0],
          messageId: 'noNameSecondArgument',
          data: { customHook: /** @type {import('estree').Identifier} */ (node.callee).name },
        });
        return null;
      }
      if (secondArgument.type !== 'Literal') {
        context.report({ node: secondArgument, messageId: 'noNameValue' });
        return null;
      }
      return secondArgument;
    }

    return {
      CallExpression(node) {
        let nameLiteral = null;
        const callee = /** @type {import('estree').Identifier} */ (node.callee);
        const isUseDefaultPropsCall =
          callee.name === 'useDefaultProps' || callee.name === 'useThemeProps';
        if (isUseDefaultPropsCall) {
          let isCalledFromCustomHook = false;
          /** @type {import('eslint').Rule.Node | null} */
          let parent = node.parent;
          while (parent != null) {
            if (parent.type === 'FunctionExpression' || parent.type === 'FunctionDeclaration') {
              if (
                customHooks.includes(/** @type {import('estree').Identifier} */ (parent.id).name)
              ) {
                isCalledFromCustomHook = true;
              }
              break;
            }

            parent = parent.parent;
          }
          if (!isCalledFromCustomHook) {
            nameLiteral = resolveUseThemePropsNameLiteral(node);
          }
        } else if (
          customHooks.includes(/** @type {import('estree').Identifier} */ (node.callee).name)
        ) {
          nameLiteral = resolveCustomHookNameLiteral(node);
        }

        if (nameLiteral !== null) {
          let componentName = null;
          /** @type {import('eslint').Rule.Node | null} */
          let parent = node.parent;
          while (parent != null && componentName === null) {
            if (parent.type === 'FunctionExpression' || parent.type === 'FunctionDeclaration') {
              componentName = /** @type {import('estree').Identifier} */ (parent.id).name;
            }

            if (
              parent.type === 'VariableDeclarator' &&
              parent.init &&
              (parent.init.type === 'CallExpression' || parent.init.type === 'TSAsExpression')
            ) {
              const parentCallee =
                parent.init.type === 'TSAsExpression'
                  ? /** @type {import('estree').CallExpression} */ (parent.init.expression).callee
                  : parent.init.callee;
              if (
                /** @type {import('estree').Identifier} */ (parentCallee).name.includes(
                  /** @type {import('estree').Identifier} */ (parent.id).name,
                )
              ) {
                // For component factory, for example const Container = createContainer({ ... })
                componentName = /** @type {import('estree').Identifier} */ (parent.id).name;
              }
            }

            parent = parent.parent;
          }

          const name = /** @type {string} */ (
            /** @type {import('estree').Literal} */ (nameLiteral).value
          );
          if (componentName === null) {
            context.report({ node, messageId: 'noComponent' });
          } else if (name !== `Mui${componentName}`) {
            context.report({
              node: nameLiteral,
              messageId: `nameMismatch`,
              data: { componentName, name },
            });
          }
        }
      },
    };
  },
};

export default rule;
