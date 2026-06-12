/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    docs: {
      description:
        'Enforces that the `name` passed to `useThemeProps`/`useDefaultProps` matches the component name. ' +
        'When the `babelDisplayNamePlugin` option is enabled, components wrapped in `forwardRef`/`memo` ' +
        'may use an anonymous or arrow render function and the component name is derived from the variable ' +
        'name (matching the `displayName` injected by `@mui/internal-babel-plugin-display-name`).',
    },
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
          babelDisplayNamePlugin: {
            type: 'boolean',
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [options = {}] = context.options;
    const { customHooks = [], babelDisplayNamePlugin = false } = options;

    /**
     * Resolves the method name of a call expression callee, handling both bare
     * identifiers (`forwardRef`) and member expressions (`React.forwardRef`).
     * Returns undefined when it cannot be determined statically.
     * @param {import('estree').Expression | import('estree').Super} callee
     */
    function resolveCalleeMethodName(callee) {
      if (callee.type === 'Identifier') {
        return callee.name;
      }
      if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
        return callee.property.name;
      }
      return undefined;
    }

    /**
     * When `node` is the render/component function passed directly to a
     * `forwardRef`/`memo` call that is assigned to a variable, returns the
     * variable name. This mirrors the `displayName` injected by
     * `@mui/internal-babel-plugin-display-name`. Returns null otherwise.
     * @param {import('eslint').Rule.Node} node
     */
    function resolveWrappedComponentName(node) {
      const call = node.parent;
      if (
        call == null ||
        call.type !== 'CallExpression' ||
        call.arguments[0] !== /** @type {import('estree').Expression} */ (node)
      ) {
        return null;
      }
      const methodName = resolveCalleeMethodName(call.callee);
      if (methodName !== 'forwardRef' && methodName !== 'memo') {
        return null;
      }
      // The call may be wrapped in a TSAsExpression before assignment.
      let assigned = /** @type {import('eslint').Rule.Node} */ (call).parent;
      if (assigned != null && assigned.type === 'TSAsExpression') {
        assigned = assigned.parent;
      }
      if (
        assigned != null &&
        assigned.type === 'VariableDeclarator' &&
        assigned.id.type === 'Identifier'
      ) {
        return assigned.id.name;
      }
      return null;
    }

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
              if (parent.id && customHooks.includes(parent.id.name)) {
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
              // For `forwardRef`/`memo`-wrapped components compiled with the babel
              // display-name plugin, the variable name wins over the inner function name.
              const wrappedName = babelDisplayNamePlugin
                ? resolveWrappedComponentName(parent)
                : null;
              if (wrappedName !== null) {
                componentName = wrappedName;
              } else {
                componentName = /** @type {import('estree').Identifier} */ (parent.id).name;
              }
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
              const methodName = resolveCalleeMethodName(parentCallee);
              if (
                babelDisplayNamePlugin &&
                parent.id.type === 'Identifier' &&
                (methodName === 'forwardRef' || methodName === 'memo')
              ) {
                // Arrow/anonymous component wrapped in `forwardRef`/`memo`: the
                // displayName comes from the variable name.
                componentName = parent.id.name;
              } else if (
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
