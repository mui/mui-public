/// @ts-check

/**
 * React APIs that are forbidden in server components (without 'use client' directive).
 */
const REACT_CLIENT_APIS = new Set([
  'createContext',
  'useContext',
  'useEffect',
  'useLayoutEffect',
  'useReducer',
  'useRef',
  'useState',
  'useTransition',
]);

/**
 * Additional APIs that should be blacklisted under server components.
 */
const SERVER_COMPONENT_BLACKLISTED_APIS = new Set(['useIsoLayoutEffect']);

/**
 * @param {import('eslint').AST.Program} ast
 * @param {string} directive
 * @returns
 */
function hasDirective(ast, directive) {
  return ast.body.some(
    (statement) =>
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'Literal' &&
      statement.expression.value === directive,
  );
}

export default /** @type {import('eslint').Rule.RuleModule} */ ({
  create(context) {
    let hasUseClientDirective = false;
    let hasUseServerDirective = false;

    /**
     * @param {import('eslint').Rule.RuleFixer} fixer
     * @returns {import('eslint').Rule.Fix | null}
     */
    function createFix(fixer) {
      if (hasUseServerDirective) {
        return null;
      }

      const firstToken = context.sourceCode.ast.body[0];
      return fixer.insertTextBefore(firstToken, "'use client';\n");
    }

    return {
      /** @param {import('eslint').AST.Program} node */
      Program(node) {
        hasUseServerDirective = hasDirective(node, 'use server');
        hasUseClientDirective = hasDirective(node, 'use client');
      },
      ImportDeclaration(node) {
        if (hasUseClientDirective) {
          return;
        }

        // Check for named imports of React APIs from 'react'
        if (node.source.value === 'react') {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier' &&
              REACT_CLIENT_APIS.has(specifier.imported.name)
            ) {
              context.report({
                node: specifier,
                message: `Importing '${specifier.imported.name}' from 'react' is forbidden if the file doesn't have a 'use client' directive.`,
                fix: createFix,
              });
            }
          }
        }

        // Check for blacklisted APIs imported from anywhere
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
            if (SERVER_COMPONENT_BLACKLISTED_APIS.has(specifier.imported.name)) {
              context.report({
                node: specifier,
                message: `Importing '${specifier.imported.name}' is forbidden if the file doesn't have a 'use client' directive.`,
                fix: createFix,
              });
            }
          } else if (specifier.type === 'ImportDefaultSpecifier') {
            if (SERVER_COMPONENT_BLACKLISTED_APIS.has(specifier.local.name)) {
              context.report({
                node: specifier,
                message: `Importing '${specifier.local.name}' is forbidden if the file doesn't have a 'use client' directive.`,
                fix: createFix,
              });
            }
          }
        }
      },
      CallExpression(node) {
        if (hasUseClientDirective) {
          return;
        }

        // Check for React.* API calls
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'React' &&
          node.callee.property.type === 'Identifier' &&
          REACT_CLIENT_APIS.has(node.callee.property.name)
        ) {
          context.report({
            node,
            message: `Using 'React.${node.callee.property.name}' is forbidden if the file doesn't have a 'use client' directive.`,
            fix: createFix,
          });
        }

        // Check for direct calls to blacklisted APIs
        if (
          node.callee.type === 'Identifier' &&
          SERVER_COMPONENT_BLACKLISTED_APIS.has(node.callee.name)
        ) {
          context.report({
            node,
            message: `Using '${node.callee.name}' is forbidden if the file doesn't have a 'use client' directive.`,
            fix: createFix,
          });
        }
      },
    };
  },
  meta: {
    fixable: 'code',
  },
});
