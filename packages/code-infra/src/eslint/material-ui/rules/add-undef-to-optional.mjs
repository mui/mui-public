import { ESLintUtils, AST_NODE_TYPES } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/mui/mui-public/blob/master/packages/code-infra/src/eslint/material-ui/rules/${name}.mjs`,
);

const RULE_NAME = 'add-undef-to-optional';

/**
 * Checks whether the given type node includes 'undefined' either directly,
 * via union, or via type references that eventually include 'undefined'.
 * Treats 'any' and 'unknown' as including 'undefined' and skips React's ReactNode.
 *
 * @param {import('@typescript-eslint/types').TSESTree.TSTypeAnnotation['typeAnnotation'] | undefined} typeNode
 * @param {Map<string, any>} typeDefinitions
 * @returns {boolean}
 */
function souldCheckProperty(typeNode, typeDefinitions) {
  if (!typeNode) {
    return false;
  }

  switch (typeNode.type) {
    case AST_NODE_TYPES.TSUnionType: {
      return typeNode.types.some((t) => souldCheckProperty(t, typeDefinitions));
    }
    case AST_NODE_TYPES.TSUndefinedKeyword:
      return true;
    case AST_NODE_TYPES.TSAnyKeyword:
      return true;
    case AST_NODE_TYPES.TSUnknownKeyword:
      return true;
    case AST_NODE_TYPES.TSTypeReference: {
      // Check if it's a reference to 'undefined' itself
      if (
        typeNode.typeName &&
        typeNode.typeName.type === AST_NODE_TYPES.Identifier &&
        typeNode.typeName.name === 'undefined'
      ) {
        return true;
      }
      // Check if it's ReactNode (which already includes undefined)
      if (typeNode.typeName) {
        if (typeNode.typeName.type === AST_NODE_TYPES.Identifier) {
          const typeName = typeNode.typeName.name;
          // ReactNode already includes undefined
          if (typeName === 'ReactNode') {
            return true;
          }
          // If we have a local definition, check it
          if (typeDefinitions.has(typeName)) {
            const typeDefinition = typeDefinitions.get(typeName);
            return souldCheckProperty(typeDefinition, typeDefinitions);
          }
          // If no local definition found, it's imported or built-in - require explicit | undefined
          return false;
        }
        // Check for React.ReactNode
        if (
          typeNode.typeName.type === AST_NODE_TYPES.TSQualifiedName &&
          typeNode.typeName.left.type === AST_NODE_TYPES.Identifier &&
          typeNode.typeName.left.name === 'React' &&
          typeNode.typeName.right.name === 'ReactNode'
        ) {
          return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

export default createRule({
  meta: {
    docs: {
      description: 'Ensures that optional properties include undefined in their type.',
    },
    messages: {
      addUndefined:
        'Optional property "{{ propName }}" type does not explicitly include undefined. Add "| undefined".',
    },
    type: 'suggestion',
    fixable: 'code',
    schema: [],
  },
  name: RULE_NAME,
  defaultOptions: [],
  create(context) {
    const typeDefinitions = new Map();

    return {
      // Collect type alias definitions, ie, type Foo = ...
      TSTypeAliasDeclaration(node) {
        if (node.id && node.typeAnnotation) {
          typeDefinitions.set(node.id.name, node.typeAnnotation);
        }
      },
      // only checks optional properties in types/interfaces
      TSPropertySignature(node) {
        if (!node.optional || !node.typeAnnotation) {
          return;
        }
        const typeNode = node.typeAnnotation.typeAnnotation;
        if (!typeNode || souldCheckProperty(typeNode, typeDefinitions)) {
          return;
        }
        const source = context.sourceCode;
        context.report({
          node: node.key ?? node,
          messageId: 'addUndefined',
          data: {
            propName: source.getText(node.key),
          },
          fix(fixer) {
            // wrap in parentheses to preserve precedence even for simple types
            // prettier can handle formatting
            return fixer.replaceText(typeNode, `(${source.getText(typeNode)}) | undefined`);
          },
        });
      },
    };
  },
});
