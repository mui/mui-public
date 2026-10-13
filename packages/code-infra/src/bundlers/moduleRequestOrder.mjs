import { types as t } from '@babel/core';

/**
 * Reads the static dependency evaluated by an emitted statement. CommonJS
 * interop wrappers are transparent, but lazy factory/function bodies are not.
 * @param {import('@babel/core').types.Statement} node
 * @param {boolean} [allowRequire=true]
 * @returns {string | undefined}
 */
export function moduleRequest(node, allowRequire = true) {
  if (
    t.isImportDeclaration(node) ||
    t.isExportNamedDeclaration(node) ||
    t.isExportAllDeclaration(node)
  ) {
    return node.source?.value;
  }
  if (!allowRequire) {
    return undefined;
  }
  /** @type {import('@babel/core').types.Expression | null | undefined} */
  let expression;
  if (t.isExpressionStatement(node)) {
    expression = node.expression;
  } else if (t.isVariableDeclaration(node) && node.declarations.length === 1) {
    expression = node.declarations[0].init;
  }
  while (t.isCallExpression(expression)) {
    /** @type {import('@babel/core').types.CallExpression['arguments'][number] | undefined} */
    const argument = expression.arguments[0];
    const callee = expression.callee;
    let name;
    if (t.isIdentifier(callee)) {
      name = callee.name;
    } else if (
      t.isMemberExpression(callee) &&
      t.isIdentifier(callee.object) &&
      /^require_.*runtime/.test(callee.object.name) &&
      !callee.computed &&
      t.isIdentifier(callee.property)
    ) {
      name = callee.property.name;
    }
    if (name === 'require' && t.isIdentifier(callee) && t.isStringLiteral(argument)) {
      return argument.value;
    }
    if (!name || !/^__toESM(?:[$_]\d+)?$/.test(name) || !t.isExpression(argument)) {
      return undefined;
    }
    expression = argument;
  }
  return undefined;
}

/**
 * Rolldown can order external imports by a shared module ID across entries.
 * Restore each source module's evaluation order, including CommonJS requires.
 * @param {import('@babel/core').types.Program} program
 * @param {import('magic-string').default} output
 * @param {string[]} requests
 * @param {Map<string, string>} resolved
 */
export function orderModuleRequests(program, output, requests, resolved) {
  /** @type {Map<string, number>} */
  const order = new Map();
  requests.forEach((source, index) => {
    const target = resolved.get(source) ?? source;
    if (!order.has(target)) {
      order.set(target, index);
    }
  });
  const allowRequire = !program.body.some((node) =>
    Object.hasOwn(t.getOuterBindingIdentifiers(node), 'require'),
  );
  const statements = program.body.filter((node) => moduleRequest(node, allowRequire) !== undefined);
  const sorted = [...statements].sort((a, b) => {
    const sourceA = moduleRequest(a, allowRequire);
    const sourceB = moduleRequest(b, allowRequire);
    /** @param {string | undefined} source */
    const rank = (source) =>
      source === undefined
        ? -1
        : (order.get(source) ?? order.get(source.replace(/^node:/, '')) ?? -1);
    return rank(sourceA) - rank(sourceB);
  });
  if (statements.every((node, index) => node === sorted[index])) {
    return false;
  }
  const position = statements[0].start;
  if (position === null || position === undefined) {
    throw new Error('Missing module request position');
  }
  const text = sorted
    .map((node) => output.original.slice(node.start ?? 0, node.end ?? 0))
    .join('\n');
  for (const node of statements) {
    if (
      node.start === null ||
      node.start === undefined ||
      node.end === null ||
      node.end === undefined
    ) {
      throw new Error('Missing module request range');
    }
    output.remove(node.start, node.end);
  }
  output.appendLeft(position, `${text}\n`);
  return true;
}
