/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'problem',
  },
  create(context) {
    /**
     * @param {import("estree").BlockStatement & import("eslint").Rule.NodeParentExtension} componentBlockNode
     * @returns {import("estree").ObjectPattern | undefined} The props object pattern of the component block node.
     */
    function getComponentProps(componentBlockNode) {
      // finds the declarator in `const {...} = props;`
      /**
       * @type {import('estree').VariableDeclarator | undefined }
       */
      let componentPropsDeclarator;
      componentBlockNode.body.forEach((node) => {
        if (node.type === 'VariableDeclaration') {
          const propsDeclarator = node.declarations.find(
            (declarator) =>
              declarator.init &&
              /** @type {import('estree').Identifier} */ (declarator.init).name === 'props',
          );
          componentPropsDeclarator = propsDeclarator;
        }
      });

      // @ts-ignore
      return componentPropsDeclarator ? componentPropsDeclarator.id : undefined;
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
        if (/** @type {import('estree').Identifier} */ (node.callee).name === 'useThemeVariants') {
          const componentBlockNode = getComponentBlockNode(node);

          const componentProps = componentBlockNode
            ? getComponentProps(componentBlockNode)
            : undefined;
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
            const componentPropKey = /** @type {import('estree').AssignmentProperty} */ (
              componentProp
            ).key;
            const componentPropKeyName = /** @type {import('estree').Identifier} */ (
              componentPropKey
            ).name;
            const isPassedToVariantProps =
              variantProps.properties.find(
                (variantProp) =>
                  variantProp.type === 'Property' &&
                  componentPropKeyName ===
                    /** @type {import('estree').Identifier} */ (variantProp.key).name,
              ) !== undefined;
            if (!isPassedToVariantProps) {
              context.report({
                node: variantProps,

                message: `Prop \`${componentPropKeyName}\` is not passed to \`useThemeVariants\` props.`,
              });
            }
          });
        }
      },
    };
  },
};
