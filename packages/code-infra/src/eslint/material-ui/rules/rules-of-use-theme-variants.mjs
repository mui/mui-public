/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'problem',
  },
  create(context) {
    /**
     * @param {import("estree").BlockStatement & import("eslint").Rule.NodeParentExtension | null} componentBlockNode
     * @returns {import("estree").ObjectPattern | undefined} The props object pattern of the component block node.
     */
    function getComponentProps(componentBlockNode) {
      // finds the declarator in `const {...} = props;`
      let componentPropsDeclarator = null;
      componentBlockNode?.body.forEach((node) => {
        if (node.type === 'VariableDeclaration') {
          const propsDeclarator = node.declarations.find(
            (declarator) => declarator.init && declarator.init.name === 'props',
          );
          if (propsDeclarator !== undefined) {
            componentPropsDeclarator = propsDeclarator;
          }
        }
      });

      return componentPropsDeclarator !== null ? componentPropsDeclarator.id : undefined;
    }

    /**
     * @param {import("estree").CallExpression & import("eslint").Rule.NodeParentExtension} hookCallNode
     */
    function getComponentBlockNode(hookCallNode) {
      let node = hookCallNode.parent;
      while (node !== undefined) {
        if (node.type === 'BlockStatement') {
          return node;
        }
        node = node.parent;
      }
      return null;
    }

    return {
      CallExpression(node) {
        if (node.callee.name === 'useThemeVariants') {
          const componentBlockNode = getComponentBlockNode(node);

          const componentProps = getComponentProps(componentBlockNode);
          const defaultProps =
            componentProps === undefined
              ? []
              : componentProps.properties.filter(
                  (objectProperty) =>
                    objectProperty.type === 'Property' &&
                    objectProperty.value.type === 'AssignmentPattern',
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

          const variantPropsRestNode = variantProps.properties.find(
            (objectProperty) => objectProperty.type === 'SpreadElement',
          );

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

          defaultProps.forEach((componentProp) => {
            const isPassedToVariantProps =
              variantProps.properties.find(
                (variantProp) =>
                  variantProp.type === 'Property' &&
                  componentProp.key.name === variantProp.key.name,
              ) !== undefined;
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
