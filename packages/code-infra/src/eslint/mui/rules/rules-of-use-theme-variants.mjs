/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'problem',
  },
  create(context) {
    /**
     * @param {(import("estree").BlockStatement & import("eslint").Rule.NodeParentExtension)} componentBlockNode
     */
    function getComponentProps(componentBlockNode) {
      // finds the declarator in `const {...} = props;`
      let componentPropsDeclarator = null;
      componentBlockNode.body.forEach((node) => {
        if (node.type === 'VariableDeclaration') {
          const propsDeclarator = node.declarations.find((declarator) => {
            // @ts-expect-error FIXME: Untyped code made wrong assumptions before we added types
            return declarator.init && declarator.init.name === 'props';
          });
          if (propsDeclarator !== undefined) {
            componentPropsDeclarator = propsDeclarator;
          }
        }
      });

      // @ts-expect-error FIXME: Untyped code made wrong assumptions before we added types
      return componentPropsDeclarator !== null ? componentPropsDeclarator.id : undefined;
    }

    /**
     * @param {import("estree").CallExpression & import("eslint").Rule.NodeParentExtension} hookCallNode
     */
    function getComponentBlockNode(hookCallNode) {
      /** @type {import("eslint").Rule.Node | null} */
      let node = hookCallNode.parent;
      while (node) {
        if (node.type === 'BlockStatement') {
          return node;
        }
        node = node.parent;
      }
      return null;
    }

    return {
      CallExpression(node) {
        // @ts-expect-error FIXME: Untyped code made wrong assumptions before we added types
        if (node.callee.name === 'useThemeVariants') {
          const componentBlockNode = getComponentBlockNode(node);

          // @ts-expect-error FIXME: Untyped code made wrong assumptions before we added types
          const componentProps = getComponentProps(componentBlockNode);
          const defaultProps =
            componentProps === undefined
              ? []
              : componentProps.properties.filter(
                  (/** @type {{ type: string; value: { type: string; }; }} */ objectProperty) => {
                    return (
                      objectProperty.type === 'Property' &&
                      objectProperty.value.type === 'AssignmentPattern'
                    );
                  },
                );

          const [variantProps] = node.arguments;

          const unsupportedComponentPropsNode =
            componentProps !== undefined && componentProps.type !== 'ObjectPattern';

          if (unsupportedComponentPropsNode) {
            context.report({
              node: componentProps,
              message: `Can only analyze object patterns but found '${componentProps.type}'. Prefer \`const {...} = props;\``,
            });
          }

          if (defaultProps.length === 0) {
            return;
          }

          if (variantProps.type !== 'ObjectExpression') {
            context.report({
              node: variantProps,
              message: `Can only analyze object patterns but found '${variantProps.type}'. Prefer \`{...props}\`.`,
            });
            return;
          }

          const variantPropsRestNode = variantProps.properties.find((objectProperty) => {
            return objectProperty.type === 'SpreadElement';
          });

          if (
            variantPropsRestNode !== undefined &&
            variantProps.properties.indexOf(variantPropsRestNode) !== 0 &&
            defaultProps.length > 0
          ) {
            context.report({
              node: variantPropsRestNode,
              message:
                'The props spread must come first in the `useThemeVariants` props. Otherwise destructured props with default values could be overridden.',
            });
          }

          defaultProps.forEach((/** @type {{ key: { name: any; }; }} */ componentProp) => {
            const isPassedToVariantProps =
              variantProps.properties.find((variantProp) => {
                return (
                  // @ts-expect-error FIXME: Untyped code made wrong assumptions before we added types
                  variantProp.type === 'Property' && componentProp.key.name === variantProp.key.name
                );
              }) !== undefined;
            if (!isPassedToVariantProps) {
              context.report({
                node: variantProps,
                message: `Prop \`${componentProp.key.name}\` is not passed to \`useThemeVariants\` props.`,
              });
            }
          });
        }
      },
    };
  },
};
