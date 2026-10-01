/**
 * @typedef {import('estree').Node} Node
 * @typedef {import('estree').PropertyDefinition & {
 *   declare?: boolean;
 *   decorators?: Node[];
 *   typeAnnotation?: Node;
 * }} PropertyDefinition
 */

const FUNCTION_OR_CLASS_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
]);

const ACCESSIBILITY_MODIFIERS = new Set(['public', 'private', 'protected']);

/**
 * Returns the static name of a non-private member key, or `null` when it can't be determined.
 * @param {Node} key
 * @param {boolean} computed
 * @returns {string | null}
 */
function getStaticName(key, computed) {
  if (!computed && key.type === 'Identifier') {
    return key.name;
  }
  if (key.type === 'Literal' && typeof key.value === 'string') {
    return key.value;
  }
  return null;
}

/**
 * Returns the property name when `node` is `this.<name>` or `this['<name>']`.
 * @param {Node} node
 * @returns {string | null}
 */
function getThisMemberName(node) {
  if (node.type !== 'MemberExpression' || node.object.type !== 'ThisExpression') {
    return null;
  }
  if (node.property.type === 'PrivateIdentifier') {
    return null;
  }
  return getStaticName(node.property, node.computed);
}

/**
 * Whether `field` can be marked `declare`: TypeScript disallows it with an initializer or
 * decorators, and it's not valid JavaScript, so only typed fields qualify.
 * @param {PropertyDefinition} field
 * @returns {boolean}
 */
function canDeclare(field) {
  return !field.value && !field.decorators?.length && Boolean(field.typeAnnotation);
}

/**
 * Collects the names of `this` members assigned in `node`, without descending into nested
 * functions or classes, as those run later (or bind a different `this`).
 * @param {Node | null | undefined} node
 * @param {Set<string>} names
 */
function collectThisAssignments(node, names) {
  if (!node || typeof node !== 'object' || FUNCTION_OR_CLASS_TYPES.has(node.type)) {
    return;
  }

  if (node.type === 'AssignmentExpression') {
    const name = getThisMemberName(node.left);
    if (name !== null) {
      names.add(name);
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }
    const child = /** @type {unknown} */ (/** @type {any} */ (node)[key]);
    if (Array.isArray(child)) {
      for (const item of child) {
        collectThisAssignments(item, names);
      }
    } else if (child && typeof child === 'object' && /** @type {Node} */ (child).type) {
      collectThisAssignments(/** @type {Node} */ (child), names);
    }
  }
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
 * Private (`#`) fields are ignored as they can't be marked `declare`.
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
      addDeclare: 'Mark the field `declare`.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;

    /**
     * Returns the token `declare` goes in front of: after the accessibility modifier, which
     * TypeScript requires to precede `declare`.
     * @param {PropertyDefinition} field
     */
    function getDeclareAnchor(field) {
      let token = sourceCode.getFirstToken(field);
      if (token && ACCESSIBILITY_MODIFIERS.has(token.value)) {
        token = sourceCode.getTokenAfter(token);
      }
      return /** @type {import('eslint').AST.Token} */ (token);
    }

    return {
      ClassBody(node) {
        const constructor = node.body.find(
          (member) => member.type === 'MethodDefinition' && member.kind === 'constructor',
        );
        if (!constructor) {
          return;
        }

        /** @type {Set<string>} */
        const assigned = new Set();
        collectThisAssignments(
          /** @type {import('estree').MethodDefinition} */ (constructor).value.body,
          assigned,
        );
        if (assigned.size === 0) {
          return;
        }

        for (const member of node.body) {
          if (member.type !== 'PropertyDefinition') {
            continue;
          }
          const field = /** @type {PropertyDefinition} */ (member);
          if (field.static || field.declare || field.key.type === 'PrivateIdentifier') {
            continue;
          }
          const name = getStaticName(field.key, field.computed);
          if (name === null || !assigned.has(name)) {
            continue;
          }

          context.report({
            node: field,
            messageId: 'assignedInConstructor',
            data: { name },
            suggest: canDeclare(field)
              ? [
                  {
                    messageId: 'addDeclare',
                    fix: (fixer) => fixer.insertTextBefore(getDeclareAnchor(field), 'declare '),
                  },
                ]
              : [],
          });
        }
      },
    };
  },
};

export default rule;
