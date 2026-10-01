import { ASTUtils } from '@typescript-eslint/utils';

/**
 * @typedef {import('@typescript-eslint/utils').TSESTree.Node} Node
 * @typedef {import('@typescript-eslint/utils').TSESTree.PropertyDefinition} PropertyDefinition
 */

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/**
 * Returns the class body of the constructor whose own code contains `node`, or `null` when
 * `node` is outside a constructor or inside a nested function or class field.
 * @param {Node} node
 * @returns {import('@typescript-eslint/utils').TSESTree.ClassBody | null}
 */
function getConstructorClassBody(node) {
  let current = node.parent;
  while (current && !FUNCTION_TYPES.has(current.type)) {
    if (current.type === 'PropertyDefinition' || current.type === 'StaticBlock') {
      return null;
    }
    current = current.parent;
  }
  const method = current?.parent;
  return method?.type === 'MethodDefinition' && method.kind === 'constructor'
    ? method.parent
    : null;
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
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
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
  create(context) {
    /** @type {Set<PropertyDefinition>} */
    const reported = new Set();

    return {
      AssignmentExpression(estreeNode) {
        const node =
          /** @type {import('@typescript-eslint/utils').TSESTree.AssignmentExpression} */ (
            /** @type {unknown} */ (estreeNode)
          );
        if (node.left.type !== 'MemberExpression' || node.left.object.type !== 'ThisExpression') {
          return;
        }
        const name = ASTUtils.getPropertyName(node.left);
        const classBody = name === null ? null : getConstructorClassBody(node);
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

        // TypeScript disallows `declare` with decorators or `override`, and it isn't valid JavaScript.
        const declarable =
          Boolean(field.typeAnnotation) && field.decorators.length === 0 && !field.override;
        // Adding `declare` directly also requires no initializer and no `!` assertion.
        const canDeclare = declarable && !field.value && !field.definite;
        context.report({
          node: /** @type {import('estree').Node} */ (/** @type {unknown} */ (field)),
          messageId: declarable ? 'assignedInConstructor' : 'assignedInConstructorNoDeclare',
          data: { name },
          suggest: canDeclare
            ? [
                {
                  messageId: 'addDeclare',
                  fix: (fixer) => fixer.insertTextBeforeRange(field.range, 'declare '),
                },
              ]
            : [],
        });
      },
    };
  },
};

export default rule;
