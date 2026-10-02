import { ASTUtils, ESLintUtils } from '@typescript-eslint/utils';

/**
 * @typedef {import('@typescript-eslint/utils').TSESTree.PropertyDefinition} PropertyDefinition
 * @typedef {import('@typescript-eslint/utils').TSESTree.Node} Node
 */

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/mui/mui-public/blob/master/packages/code-infra/src/eslint/mui/rules/${name}.mjs`,
);

/**
 * Returns the constructor whose own code contains `node`, or `null` when `node` is outside a
 * constructor or inside a nested function or class.
 * @param {Node} node
 */
function getEnclosingConstructor(node) {
  let current = node.parent;
  while (current && !ASTUtils.isFunction(current)) {
    if (current.type === 'ClassBody') {
      return null;
    }
    current = current.parent;
  }
  const method = current?.parent;
  return method && ASTUtils.isConstructor(method) ? method : null;
}

/**
 * Returns the extra edits needed before `field` can be marked `declare`.
 * @param {PropertyDefinition} field
 */
function getDeclareHint(field) {
  const edits = [];
  if (field.value) {
    edits.push('drop its initializer');
  }
  if (field.definite) {
    edits.push('drop the `!`');
  }
  if (field.override) {
    edits.push('drop `override`');
  }
  return edits.length > 0 ? ` (${edits.join(', ')})` : '';
}

/**
 * ESLint rule that disallows assigning a class field in the constructor when it is also
 * declared as a (non-`declare`) class field.
 *
 * Babel 8 only strips TypeScript fields marked `declare` (see mui/material-ui#49241), so a
 * field without an initializer is emitted as a property definition that sets it to
 * `undefined` before the constructor assigns it again. Either initialize the field at its
 * declaration, or mark it `declare` so it only serves as a type annotation.
 *
 * `declare` fields are exempt from TypeScript's strict property initialization check
 * (TS2564), so prefer initializing at the declaration where the value doesn't depend on
 * constructor arguments. The `declare` suggestion is only offered when every path through the
 * constructor assigns the field, i.e. for an unconditional top-level assignment.
 *
 * Only plain `=` assignments count: compound assignments read the field rather than
 * re-initialize it. A field with an initializer is only reported for an unconditional
 * top-level assignment, as a conditional one overrides a default. Private (`#`) and decorated
 * fields are ignored: they are runtime declarations that `declare` can't replace.
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
 *   constructor(modals: Modal[]) {
 *     this.modals = modals;
 *   }
 * }
 */
export default createRule({
  name: 'no-constructor-assigned-field',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow assigning class fields in the constructor when they are also declared as class fields',
    },
    hasSuggestions: true,
    messages: {
      assignedInConstructor:
        "Field '{{name}}' is declared as a class field and also assigned in the constructor. " +
        'Either initialize it at the declaration and remove the constructor assignment, ' +
        'or mark it `declare`{{declareHint}}.',
      addDeclare: 'Mark the field `declare`.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    /**
     * Fields assigned in a constructor, mapped to whether any of those assignments is an
     * unconditional top-level statement.
     * @type {Map<PropertyDefinition, boolean>}
     */
    const assignedFields = new Map();

    return {
      AssignmentExpression(node) {
        if (
          node.operator !== '=' ||
          node.left.type !== 'MemberExpression' ||
          node.left.object.type !== 'ThisExpression'
        ) {
          return;
        }
        const name = ASTUtils.getPropertyName(node.left);
        if (name === null) {
          return;
        }
        const constructor = getEnclosingConstructor(node);
        if (!constructor) {
          return;
        }

        const field = constructor.parent.body.find(
          /** @returns {member is PropertyDefinition} */
          (member) =>
            member.type === 'PropertyDefinition' &&
            !member.static &&
            !member.declare &&
            member.decorators.length === 0 &&
            ASTUtils.getPropertyName(member) === name,
        );
        if (!field) {
          return;
        }

        const statement = node.parent;
        const unconditional =
          statement.type === 'ExpressionStatement' && statement.parent === constructor.value.body;
        assignedFields.set(field, Boolean(assignedFields.get(field)) || unconditional);
      },
      'ClassBody:exit'(classBody) {
        for (const member of classBody.body) {
          if (member.type !== 'PropertyDefinition' || !assignedFields.has(member)) {
            continue;
          }
          const unconditional = Boolean(assignedFields.get(member));
          if (member.value && !unconditional) {
            continue;
          }

          const declareHint = getDeclareHint(member);
          context.report({
            node: member,
            messageId: 'assignedInConstructor',
            data: { name: ASTUtils.getPropertyName(member), declareHint },
            suggest:
              unconditional && declareHint === ''
                ? [
                    {
                      messageId: 'addDeclare',
                      fix: (fixer) => fixer.insertTextBefore(member, 'declare '),
                    },
                  ]
                : [],
          });
        }
      },
    };
  },
});
