import { ASTUtils, ESLintUtils } from '@typescript-eslint/utils';

/** @typedef {import('@typescript-eslint/utils').TSESTree.PropertyDefinition} PropertyDefinition */

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/mui/mui-public/blob/master/packages/code-infra/src/eslint/mui/rules/${name}.mjs`,
);

/**
 * Returns the class body of the constructor whose own code contains `node`, or `null` when
 * `node` is outside a constructor or inside a nested function or class.
 * @param {import('@typescript-eslint/utils').TSESTree.Node} node
 */
function getConstructorClassBody(node) {
  let current = node.parent;
  while (current && !ASTUtils.isFunction(current)) {
    if (current.type === 'ClassBody') {
      return null;
    }
    current = current.parent;
  }
  const method = current?.parent;
  return method && ASTUtils.isConstructor(method) ? method.parent : null;
}

/**
 * ESLint rule that disallows assigning a class field in the constructor when it is also
 * declared as a (non-`declare`) class field.
 *
 * Class fields are emitted as real property definitions, so such a field is initialized
 * twice: once by the field definition (to `undefined` when it has no initializer) and once by
 * the constructor. Either initialize the field at its declaration, or mark it `declare` so it
 * only serves as a type annotation.
 *
 * Private (`#`) fields are ignored: they are runtime JavaScript, not type-only declarations,
 * and often have no alternative to constructor initialization.
 *
 * @example
 * // Invalid
 * class ModalManager {
 *   private modals: Modal[];
 *   constructor() {
 *     this.modals = [];
 *   }
 * }
 *
 * @example
 * // Valid - initialized at the declaration
 * class ModalManager {
 *   private modals: Modal[] = [];
 * }
 *
 * @example
 * // Valid - declared only, assigned in the constructor
 * class ModalManager {
 *   declare private modals: Modal[];
 *   constructor() {
 *     this.modals = [];
 *   }
 * }
 */
export default createRule({
  name: 'no-constructor-assigned-field',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow assigning class fields in the constructor when they are also declared as class fields',
    },
    hasSuggestions: true,
    messages: {
      assignedInConstructor:
        "Field '{{name}}' is declared as a class field and also assigned in the constructor. " +
        'Either initialize it at the declaration and remove the constructor assignment, or mark it `declare`.',
      assignedInConstructorNoDeclare:
        "Field '{{name}}' is declared as a class field and also assigned in the constructor. " +
        'Either initialize it at the declaration and remove the constructor assignment, or remove the field.',
      addDeclare: 'Mark the field `declare`.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    /** @type {Set<PropertyDefinition>} */
    const reported = new Set();

    return {
      AssignmentExpression(node) {
        if (node.left.type !== 'MemberExpression' || node.left.object.type !== 'ThisExpression') {
          return;
        }
        const name = ASTUtils.getPropertyName(node.left);
        if (name === null) {
          return;
        }
        const classBody = getConstructorClassBody(node);
        if (!classBody) {
          return;
        }

        const field = classBody.body.find(
          /** @returns {member is PropertyDefinition} */
          (member) =>
            member.type === 'PropertyDefinition' &&
            !member.static &&
            !member.declare &&
            ASTUtils.getPropertyName(member) === name,
        );
        if (!field || reported.has(field)) {
          return;
        }
        reported.add(field);

        // TypeScript disallows `declare` with decorators, and it isn't valid JavaScript.
        const declarable = Boolean(field.typeAnnotation) && field.decorators.length === 0;
        context.report({
          node: field,
          messageId: declarable ? 'assignedInConstructor' : 'assignedInConstructorNoDeclare',
          data: { name },
          // Prepending `declare` alone isn't enough when the field also has an initializer,
          // a `!` assertion, or `override`, as TypeScript rejects those with `declare`.
          suggest:
            declarable && !field.value && !field.definite && !field.override
              ? [
                  {
                    messageId: 'addDeclare',
                    fix: (fixer) => fixer.insertTextBefore(field, 'declare '),
                  },
                ]
              : [],
        });
      },
    };
  },
});
