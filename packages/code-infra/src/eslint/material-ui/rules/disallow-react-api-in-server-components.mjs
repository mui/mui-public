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
 * Additional APIs that are forbidden in server components.
 */
const SERVER_COMPONENT_FORBIDDEN_APIS = new Set(['useIsoLayoutEffect']);

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

    /**
     * Reports a forbidden API usage.
     * @param {import('estree').Node} node - The AST node to report
     * @param {string} apiName - The name of the forbidden API
     * @param {'Using' | 'Importing'} action - Whether the API is being used or imported
     */
    function reportForbiddenApi(node, apiName, action) {
      context.report({
        node,
        message: `${action} '${apiName}' is forbidden if the file doesn't have a 'use client' directive.`,
        fix: createFix,
      });
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
              reportForbiddenApi(specifier, `${specifier.imported.name}' from 'react`, 'Importing');
            }
          }
        }

        // Check for forbidden APIs imported from anywhere
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
            if (SERVER_COMPONENT_FORBIDDEN_APIS.has(specifier.imported.name)) {
              reportForbiddenApi(specifier, specifier.imported.name, 'Importing');
            }
          } else if (specifier.type === 'ImportDefaultSpecifier') {
            if (SERVER_COMPONENT_FORBIDDEN_APIS.has(specifier.local.name)) {
              reportForbiddenApi(specifier, specifier.local.name, 'Importing');
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
          reportForbiddenApi(node, `React.${node.callee.property.name}`, 'Using');
        }

        // Check for direct calls to forbidden APIs
        if (
          node.callee.type === 'Identifier' &&
          SERVER_COMPONENT_FORBIDDEN_APIS.has(node.callee.name)
        ) {
          reportForbiddenApi(node, node.callee.name, 'Using');
        }
      },
    };
  },
  meta: {
    fixable: 'code',
  },
});
