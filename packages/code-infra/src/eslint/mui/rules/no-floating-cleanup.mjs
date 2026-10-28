import { ESLintUtils } from '@typescript-eslint/utils';
import ts from 'typescript';

/**
 * no-floating-cleanup
 *
 * Like `@typescript-eslint/no-floating-promises`, but for functions: reports
 * call expressions used as statements whose return value is a function
 * (e.g. an `unsubscribe` / cleanup callback). Ignoring such a value usually
 * means the subscription can never be torn down — a leak.
 *
 * Requires type information (parserOptions.project / projectService).
 *
 * Calls whose resolved signature declares a `this` return type are never
 * reported: fluent / builder APIs (e.g. d3 scales) chain by returning `this`,
 * so the discarded result is callable but not a leaked cleanup function.
 *
 * Opt-out at a call site, same convention as no-floating-promises:
 *   void subscribe(cb);
 */

const RULE_NAME = 'no-floating-cleanup';

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/mui/mui-public/blob/master/packages/code-infra/src/eslint/mui/rules/${name}.mjs`,
);

export default createRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow ignoring returned cleanup/unsubscribe functions, which leaks subscriptions.',
    },
    messages: {
      floatingCleanup:
        "Return value of type '{{typeName}}' is ignored. This likely leaks a subscription — " +
        'store the cleanup function, or discard it explicitly with the `void` operator.',
    },
    schema: [],
  },
  name: RULE_NAME,
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    /**
     * Does this type (or any union member) look like a cleanup function?
     * @param {import('typescript').Type} type
     * @returns {boolean}
     */
    function isCleanupType(type) {
      if (type.isUnion()) {
        return type.types.some(isCleanupType);
      }
      // Never fire on any/unknown/never — too noisy and not provable.
      // eslint-disable-next-line no-bitwise -- TypeScript type flags are a bitmask
      if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) {
        return false;
      }

      return checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0;
    }

    /**
     * @param {import('typescript').Type} type
     * @returns {string}
     */
    function describeType(type) {
      return (type.aliasSymbol && type.aliasSymbol.getName()) || checker.typeToString(type);
    }

    /**
     * Does this call resolve to a signature that returns `this`? Fluent /
     * builder APIs (e.g. d3 scales) chain by returning `this`, so the
     * discarded result is callable but never a leaked cleanup function —
     * those calls should not be reported. Covers both an explicit `: this`
     * annotation and an inferred `this` return (no annotation).
     * @param {import('@typescript-eslint/utils').TSESTree.Node} estreeCall
     * @returns {boolean}
     */
    function returnsThis(estreeCall) {
      /** @type {import('typescript').Node | undefined} */
      let tsNode = services.esTreeNodeToTSNodeMap.get(estreeCall);
      // Unwrap `await (...)` / parens down to the underlying call.
      while (tsNode && (ts.isAwaitExpression(tsNode) || ts.isParenthesizedExpression(tsNode))) {
        tsNode = tsNode.expression;
      }
      if (!tsNode || !(ts.isCallExpression(tsNode) || ts.isNewExpression(tsNode))) {
        return false;
      }
      const declaration = checker.getResolvedSignature(tsNode)?.getDeclaration();
      if (!declaration) {
        return false;
      }
      // Explicit `: this` annotation.
      if (declaration.type?.kind === ts.SyntaxKind.ThisType) {
        return true;
      }
      // Inferred `this` return: the *declared* (uninstantiated) signature's
      // return type is the polymorphic `this` type, which prints as `this`.
      // (The resolved signature would have it bound to the receiver type.)
      const declaredSignature = checker.getSignatureFromDeclaration(declaration);
      return (
        !!declaredSignature &&
        checker.typeToString(checker.getReturnTypeOfSignature(declaredSignature)) === 'this'
      );
    }

    /**
     * Unwrap an expression-statement expression down to the calls whose
     * results are being discarded. Mirrors the cases no-floating-promises
     * handles: plain calls, optional chains, `await`, comma sequences,
     * and the operand(s) of unary / logical / conditional expressions.
     * A top-level `void` operator is the explicit opt-out, so we stop there.
     * @param {import('@typescript-eslint/utils').TSESTree.Node} expr
     * @param {import('@typescript-eslint/utils').TSESTree.Node[]} [out]
     * @returns {import('@typescript-eslint/utils').TSESTree.Node[]}
     */
    function findDiscardedCalls(expr, out = []) {
      switch (expr.type) {
        case 'CallExpression':
        case 'NewExpression':
          out.push(expr);
          break;
        case 'ChainExpression':
          findDiscardedCalls(expr.expression, out);
          break;
        case 'AwaitExpression':
          // type of the AwaitExpression node is already the awaited type
          if (expr.argument.type === 'CallExpression' || expr.argument.type === 'ChainExpression') {
            out.push(expr);
          }
          break;
        case 'UnaryExpression':
          // `void expr` is the explicit opt-out; any other unary operator
          // (e.g. `!subscribe()`) still discards the operand's result.
          if (expr.operator !== 'void') {
            findDiscardedCalls(expr.argument, out);
          }
          break;
        case 'LogicalExpression':
          // `a && subscribe()`, `a || subscribe()`, `a ?? subscribe()`:
          // either side may be the discarded value.
          findDiscardedCalls(expr.left, out);
          findDiscardedCalls(expr.right, out);
          break;
        case 'ConditionalExpression':
          // `cond ? subscribe() : other()`: the branches are discarded,
          // not the test.
          findDiscardedCalls(expr.consequent, out);
          findDiscardedCalls(expr.alternate, out);
          break;
        case 'SequenceExpression':
          // every value except the last is discarded; the last one is the
          // statement's value, which is also discarded here
          expr.expressions.forEach((subExpr) => findDiscardedCalls(subExpr, out));
          break;
        default:
          break;
      }
      return out;
    }

    return {
      /** @param {import('@typescript-eslint/utils').TSESTree.ExpressionStatement} node */
      ExpressionStatement(node) {
        findDiscardedCalls(node.expression).forEach((call) => {
          // Fluent/builder calls return `this` for chaining — not a leak.
          if (returnsThis(call)) {
            return;
          }
          const type = services.getTypeAtLocation(call);
          if (isCleanupType(type)) {
            context.report({
              node: call,
              messageId: 'floatingCleanup',
              data: { typeName: describeType(type) },
            });
          }
        });
      },
    };
  },
});
