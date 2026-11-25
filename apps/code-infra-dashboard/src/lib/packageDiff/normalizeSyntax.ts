// Rewrites the JavaScript and TypeScript ASTs Prettier parses into one canonical spelling for
// constructs that build tools print differently, so the diff only shows what they compile to.
// It handles both AST shapes Prettier produces: Babel's (`babel` parser) and ESTree's
// (`typescript` parser).

interface Node {
  type: string;
  [key: string]: unknown;
}

const POSITION_KEYS = ['start', 'end', 'range', 'loc'];

// Prettier reads node positions to place comments and keep blank lines, so nodes created here
// take over the position of the node they stand in for.
function create(type: string, from: Node, props: Record<string, unknown>): Node {
  const node: Node = { type, ...props };
  for (const key of POSITION_KEYS) {
    if (key in from) {
      node[key] = from[key];
    }
  }
  return node;
}

// An empty position right after `node`, for the nodes added at the end of the module
function positionAfter(node: Node): Node {
  const position: Node = { type: 'Position' };
  if (typeof node.end === 'number') {
    position.start = node.end;
    position.end = node.end;
  }
  if (Array.isArray(node.range)) {
    position.range = [node.range[1], node.range[1]];
  }
  const loc = node.loc as { end: unknown } | undefined;
  if (loc) {
    position.loc = { start: loc.end, end: loc.end };
  }
  return position;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

function isNumericLiteral(node: unknown): node is Node {
  return (
    isNode(node) &&
    (node.type === 'NumericLiteral' || (node.type === 'Literal' && typeof node.value === 'number'))
  );
}

function isIdentifier(node: unknown, name?: string): node is Node {
  return isNode(node) && node.type === 'Identifier' && (name === undefined || node.name === name);
}

function getName(node: unknown): string {
  if (!isNode(node)) {
    return '';
  }
  return String(node.type === 'Identifier' ? node.name : node.value);
}

function wrapInBlock(statement: unknown): unknown {
  if (!isNode(statement) || statement.type === 'BlockStatement') {
    return statement;
  }
  return create('BlockStatement', statement, { body: [statement], directives: [] });
}

function compareSpecifiers(a: Node, b: Node): number {
  const keyA = `${getName(a.imported ?? a.local)}:${getName(a.exported ?? a.local)}`;
  const keyB = `${getName(b.imported ?? b.local)}:${getName(b.exported ?? b.local)}`;
  return keyA.localeCompare(keyB);
}

function sortSpecifiers(node: Node) {
  const specifiers = node.specifiers as Node[];
  // Default and namespace specifiers must stay in front of the braces
  const named = specifiers.filter(
    (specifier) => specifier.type === 'ImportSpecifier' || specifier.type === 'ExportSpecifier',
  );
  const others = specifiers.filter((specifier) => !named.includes(specifier));
  node.specifiers = [...others, ...named.sort(compareSpecifiers)];
}

function normalizeNode(node: Node, isDeclarationFile: boolean): Node {
  switch (node.type) {
    case 'NumericLiteral':
    case 'Literal':
      // `10_000`, `1e4` and `10000` are the same number, Prettier prints the raw spelling
      if (isNumericLiteral(node)) {
        const raw = String(node.value);
        if (node.extra && typeof node.extra === 'object') {
          node.extra = { ...node.extra, raw };
        }
        if ('raw' in node) {
          node.raw = raw;
        }
      }
      return node;
    case 'UnaryExpression':
      // `void 0` is how minifiers spell `undefined`. This assumes nothing shadows `undefined`.
      if (
        node.operator === 'void' &&
        isNumericLiteral(node.argument) &&
        node.argument.value === 0
      ) {
        return create('Identifier', node, { name: 'undefined' });
      }
      return node;
    case 'ReturnStatement':
      if (isIdentifier(node.argument, 'undefined')) {
        node.argument = null;
      }
      return node;
    case 'IfStatement':
      node.consequent = wrapInBlock(node.consequent);
      if (isNode(node.alternate)) {
        const alternate = node.alternate;
        // `else { if (a) {} }` is `else if (a) {}`
        if (
          alternate.type === 'BlockStatement' &&
          (alternate.body as Node[]).length === 1 &&
          (alternate.body as Node[])[0].type === 'IfStatement'
        ) {
          node.alternate = (alternate.body as Node[])[0];
        } else if (alternate.type !== 'IfStatement') {
          node.alternate = wrapInBlock(alternate);
        }
      }
      return node;
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
      node.body = wrapInBlock(node.body);
      return node;
    case 'ObjectProperty':
    case 'Property':
      // `{ children: children }` is `{ children }`
      if (
        !node.computed &&
        !node.method &&
        isIdentifier(node.key) &&
        isIdentifier(node.value, node.key.name as string)
      ) {
        node.shorthand = true;
      }
      return node;
    case 'ImportDeclaration':
      sortSpecifiers(node);
      if (isDeclarationFile) {
        // In declaration files `import type` and `import` mean the same thing
        node.importKind = 'value';
        for (const specifier of node.specifiers as Node[]) {
          if (specifier.importKind) {
            specifier.importKind = 'value';
          }
        }
      }
      return node;
    case 'ExportNamedDeclaration':
      if (node.specifiers) {
        sortSpecifiers(node);
      }
      if (isDeclarationFile) {
        node.exportKind = 'value';
        for (const specifier of (node.specifiers as Node[] | undefined) ?? []) {
          if (specifier.exportKind) {
            specifier.exportKind = 'value';
          }
        }
      }
      return node;
    default:
      return node;
  }
}

function visit(node: Node, isDeclarationFile: boolean): Node {
  for (const [key, value] of Object.entries(node)) {
    if (POSITION_KEYS.includes(key) || key === 'comments' || key === 'tokens' || key === 'extra') {
      continue;
    }
    if (Array.isArray(value)) {
      node[key] = value.map((child) => (isNode(child) ? visit(child, isDeclarationFile) : child));
    } else if (isNode(value)) {
      node[key] = visit(value, isDeclarationFile);
    }
  }
  return normalizeNode(node, isDeclarationFile);
}

// `var X = class X {}` and `var X = class {}` are what bundlers make of `class X {}`.
function toClassDeclaration(statement: Node): Node {
  if (statement.type !== 'VariableDeclaration') {
    return statement;
  }
  const declarations = statement.declarations as Node[];
  if (declarations.length !== 1) {
    return statement;
  }
  const [{ id, init }] = declarations;
  if (
    !isIdentifier(id) ||
    !isNode(init) ||
    init.type !== 'ClassExpression' ||
    (init.id && !isIdentifier(init.id, id.name as string))
  ) {
    return statement;
  }
  return create('ClassDeclaration', statement, { ...init, type: 'ClassDeclaration', id });
}

function getDeclaredNames(declaration: Node): string[] {
  if (declaration.type === 'VariableDeclaration') {
    return (declaration.declarations as Node[]).flatMap((declarator) =>
      isIdentifier(declarator.id) ? [declarator.id.name as string] : [],
    );
  }
  return isIdentifier(declaration.id) ? [declaration.id.name as string] : [];
}

// Bundlers export from one list at the end of the module, `tsc` and Babel mark each declaration.
// Both become plain declarations followed by one sorted `export { ... }`.
function hoistExports(program: Node, isDeclarationFile: boolean) {
  const body = program.body as Node[];
  const exportedNames = new Set<string>();
  const statements: Node[] = [];
  let last: Node | undefined;
  for (const original of body) {
    const statement = toClassDeclaration(original);
    last = original;
    if (
      statement.type !== 'ExportNamedDeclaration' ||
      statement.source ||
      // Outside declaration files `export type { A }` can't join a value export list
      (!isDeclarationFile && !statement.declaration && statement.exportKind === 'type')
    ) {
      statements.push(statement);
      continue;
    }
    if (isNode(statement.declaration)) {
      const declaration = toClassDeclaration(statement.declaration);
      const names = getDeclaredNames(declaration);
      // Destructuring declarations and `declare module 'x'` keep their `export`
      if (names.length === 0) {
        statements.push(statement);
        continue;
      }
      statements.push(declaration);
      names.forEach((name) => exportedNames.add(name));
      continue;
    }
    const specifiers = statement.specifiers as Node[];
    // `export {}` marks a file as a module, keep it as is
    if (
      specifiers.length === 0 ||
      specifiers.some(
        (specifier) =>
          !isIdentifier(specifier.local) ||
          getName(specifier.local) !== getName(specifier.exported) ||
          (!isDeclarationFile && specifier.exportKind === 'type'),
      )
    ) {
      statements.push(statement);
      continue;
    }
    specifiers.forEach((specifier) => exportedNames.add(getName(specifier.local)));
  }
  program.body = statements;
  if (exportedNames.size === 0 || !last) {
    return;
  }
  const end = positionAfter(last);
  const specifiers = [...exportedNames].sort().map((name) =>
    create('ExportSpecifier', end, {
      local: create('Identifier', end, { name }),
      exported: create('Identifier', end, { name }),
      exportKind: 'value',
    }),
  );
  statements.push(
    create('ExportNamedDeclaration', end, {
      declaration: null,
      specifiers,
      source: null,
      exportKind: 'value',
      attributes: [],
    }),
  );
}

/**
 * Normalizes a JavaScript or TypeScript AST parsed by Prettier in place. Other ASTs are left
 * alone.
 */
export function normalizeSyntax(ast: unknown, filepath: string | undefined) {
  if (!isNode(ast)) {
    return;
  }
  const program = ast.type === 'File' ? ast.program : ast;
  if (!isNode(program) || program.type !== 'Program') {
    return;
  }
  const isDeclarationFile = /\.d\.[cm]?ts$/.test(filepath ?? '');
  hoistExports(program, isDeclarationFile);
  visit(program, isDeclarationFile);
}
