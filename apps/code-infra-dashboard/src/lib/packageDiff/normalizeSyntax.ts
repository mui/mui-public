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

function negate(expression: Node): Node {
  return create('UnaryExpression', expression, {
    operator: '!',
    prefix: true,
    argument: expression,
  });
}

function toStatementBlock(expression: Node): Node {
  const statement = normalizeNode(create('ExpressionStatement', expression, { expression }), false);
  return create('BlockStatement', expression, { body: [statement], directives: [] });
}

// Build tools turn `if (a) b();` into `a && b();` or `a ? b() : void 0;`. As statements, the
// value is thrown away, so all of them are the same `if`.
function toIfStatement(statement: Node): Node {
  const expression = statement.expression;
  if (!isNode(expression)) {
    return statement;
  }
  if (
    expression.type === 'LogicalExpression' &&
    (expression.operator === '&&' || expression.operator === '||')
  ) {
    const left = expression.left as Node;
    return create('IfStatement', statement, {
      test: expression.operator === '&&' ? left : negate(left),
      consequent: toStatementBlock(expression.right as Node),
      alternate: null,
    });
  }
  if (expression.type === 'ConditionalExpression') {
    const consequent = expression.consequent as Node;
    const alternate = expression.alternate as Node;
    if (isIdentifier(alternate, 'undefined')) {
      return create('IfStatement', statement, {
        test: expression.test,
        consequent: toStatementBlock(consequent),
        alternate: null,
      });
    }
    if (isIdentifier(consequent, 'undefined')) {
      return create('IfStatement', statement, {
        test: negate(expression.test as Node),
        consequent: toStatementBlock(alternate),
        alternate: null,
      });
    }
    return create('IfStatement', statement, {
      test: expression.test,
      consequent: toStatementBlock(consequent),
      alternate: toStatementBlock(alternate),
    });
  }
  return statement;
}

// A `return;` at the end of a function body does nothing
function removeTrailingReturn(fn: Node) {
  const body = fn.body;
  if (!isNode(body) || body.type !== 'BlockStatement') {
    return;
  }
  const statements = body.body as Node[];
  const last = statements[statements.length - 1];
  if (last?.type === 'ReturnStatement' && !last.argument) {
    body.body = statements.slice(0, -1);
  }
}

function normalizeNode(node: Node, isDeclarationFile: boolean): Node {
  switch (node.type) {
    case 'ExpressionStatement':
      return toIfStatement(node);
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ObjectMethod':
    case 'ClassMethod':
    case 'ClassPrivateMethod':
      removeTrailingReturn(node);
      return node;
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
      // `{ children: children }` is `{ children }`, and `{ a: a = 1 }` is `{ a = 1 }`
      if (
        !node.computed &&
        !node.method &&
        isIdentifier(node.key) &&
        (isIdentifier(node.value, node.key.name as string) ||
          (isNode(node.value) &&
            node.value.type === 'AssignmentPattern' &&
            isIdentifier(node.value.left, node.key.name as string)))
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

// Identifiers that aren't bindings or references: property names, labels and the names
// imports and exports have outside the module.
function isNameOnly(parent: Node | null, key: string): boolean {
  if (!parent) {
    return false;
  }
  switch (parent.type) {
    case 'MemberExpression':
    case 'OptionalMemberExpression':
    case 'TSQualifiedName':
      return key === 'property' || key === 'right' ? !parent.computed : false;
    case 'ObjectProperty':
    case 'Property':
    case 'ObjectMethod':
    case 'ClassMethod':
    case 'ClassProperty':
    case 'ClassAccessorProperty':
    case 'MethodDefinition':
    case 'PropertyDefinition':
    case 'AccessorProperty':
    case 'TSPropertySignature':
    case 'TSMethodSignature':
    case 'TSAbstractMethodDefinition':
    case 'TSAbstractPropertyDefinition':
      return key === 'key' && !parent.computed;
    case 'ImportSpecifier':
      return key === 'imported';
    case 'ExportSpecifier':
      return key === 'exported' || (key === 'local' && Boolean(parent.isReexport));
    case 'ExportNamespaceSpecifier':
    case 'ExportAllDeclaration':
      return key === 'exported';
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return key === 'label';
    case 'MetaProperty':
      return true;
    case 'TSEnumMember':
      return key === 'id';
    case 'TSImportType':
      return key === 'qualifier';
    case 'ImportAttribute':
      return key === 'key';
    default:
      return false;
  }
}

function isAmbientModule(node: Node): boolean {
  return (
    node.type === 'TSModuleDeclaration' &&
    (Boolean(node.global) || node.kind === 'global' || !isIdentifier(node.id))
  );
}

type Visitor = (node: Node, parent: Node | null, key: string, inAmbientModule: boolean) => void;

function walk(
  node: Node,
  visitor: Visitor,
  parent: Node | null = null,
  key = '',
  inAmbientModule = false,
) {
  visitor(node, parent, key, inAmbientModule);
  const ambient = inAmbientModule || isAmbientModule(node);
  for (const [childKey, value] of Object.entries(node)) {
    if (POSITION_KEYS.includes(childKey) || childKey === 'extra' || childKey === 'comments') {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((child) => isNode(child) && walk(child, visitor, node, childKey, ambient));
    } else if (isNode(value)) {
      walk(value, visitor, node, childKey, ambient);
    }
  }
}

function getPatternNames(pattern: unknown): string[] {
  if (!isNode(pattern)) {
    return [];
  }
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name as string];
    case 'ObjectPattern':
      return (pattern.properties as Node[]).flatMap((property) =>
        getPatternNames(property.type === 'RestElement' ? property.argument : property.value),
      );
    case 'ArrayPattern':
      return (pattern.elements as unknown[]).flatMap(getPatternNames);
    case 'AssignmentPattern':
      return getPatternNames(pattern.left);
    case 'RestElement':
      return getPatternNames(pattern.argument);
    default:
      return [];
  }
}

function getModuleBindings(program: Node): string[] {
  const names: string[] = [];
  for (const statement of program.body as Node[]) {
    if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers as Node[]) {
        names.push(getName(specifier.local));
      }
    } else {
      const declaration = isNode(statement.declaration) ? statement.declaration : statement;
      if (declaration.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations as Node[]) {
          names.push(...getPatternNames(declarator.id));
        }
      } else {
        names.push(...getDeclaredNames(declaration));
      }
    }
  }
  return names;
}

const RESERVED_NAMES = new Set(
  'arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof undefined var void while with yield'.split(
    ' ',
  ),
);

// `_jsx`, `capitalize_default` and `Theme$1` are names build tools give to `jsx`, `capitalize`
// and `Theme`.
function getCanonicalName(name: string): string {
  return name
    .replace(/^_+(?=[A-Za-z$])/, '')
    .replace(/\$\d+$/, '')
    .replace(/_default$/, '');
}

/**
 * Renames module-level bindings to their canonical name. Every binding and reference with the
 * old name in the file is renamed, so the code means the same as long as the new name isn't
 * used in the file already.
 */
function renameBindings(program: Node) {
  const used = new Set<string>();
  const blocked = new Set<string>();
  walk(program, (node, parent, key, inAmbientModule) => {
    if (node.type === 'JSXIdentifier') {
      blocked.add(node.name as string);
    } else if (node.type === 'Identifier' && !isNameOnly(parent, key)) {
      used.add(node.name as string);
      if (inAmbientModule) {
        // Renaming here would change what a `declare module` block augments
        blocked.add(node.name as string);
      }
    }
  });
  const targets = new Map<string, string[]>();
  for (const name of getModuleBindings(program)) {
    const target = getCanonicalName(name);
    if (target && target !== name && !RESERVED_NAMES.has(target) && !blocked.has(name)) {
      targets.set(target, [...(targets.get(target) ?? []), name]);
    }
  }
  const renames = new Map<string, string>();
  for (const [target, names] of targets) {
    if (names.length === 1 && !used.has(target)) {
      renames.set(names[0], target);
    }
  }
  if (renames.size === 0) {
    return;
  }
  walk(program, (node, parent, key) => {
    // `{ a }` and `{ a = 1 }` name a property as well as a binding. The property keeps its name,
    // which may share the identifier node with the binding.
    if (
      (node.type === 'ObjectProperty' || node.type === 'Property') &&
      node.shorthand &&
      isIdentifier(node.key) &&
      renames.has(node.key.name as string)
    ) {
      node.key = { ...node.key };
      node.shorthand = false;
      return;
    }
    if (node.type !== 'Identifier' || isNameOnly(parent, key) || !parent) {
      return;
    }
    const target = renames.get(node.name as string);
    if (!target) {
      return;
    }
    // Specifiers can share the identifier node between the local and the outside name
    if (parent.type === 'ExportSpecifier' && parent.exported === node) {
      parent.exported = { ...node };
    } else if (parent.type === 'ImportSpecifier' && parent.imported === node) {
      parent.imported = { ...node };
    }
    node.name = target;
  });
  // Prettier prints `{ a as a }` unless both names are the same node in the source
  walk(program, (node) => {
    if (node.type !== 'ImportSpecifier' && node.type !== 'ExportSpecifier') {
      return;
    }
    const outside = node.type === 'ImportSpecifier' ? node.imported : node.exported;
    if (isNode(outside) && isNode(node.local) && getName(outside) === getName(node.local)) {
      for (const key of POSITION_KEYS) {
        if (key in outside) {
          node.local[key] = outside[key];
        }
      }
    }
  });
}

function countReferences(program: Node): Map<string, number> {
  const counts = new Map<string, number>();
  walk(program, (node, parent, key) => {
    if (node.type === 'Identifier' && !isNameOnly(parent, key)) {
      counts.set(node.name as string, (counts.get(node.name as string) ?? 0) + 1);
    }
  });
  return counts;
}

/**
 * `export default a` and `export { a as default }` mean the same for a binding that never
 * changes, and a variable only the export uses is `export default <its value>`. Babel keeps the
 * `export default <value>` of the source, bundlers assign it to a variable first.
 */
function normalizeDefaultExport(program: Node) {
  const body = program.body as Node[];
  const constants = new Set<string>();
  for (const statement of body) {
    if (statement.type === 'VariableDeclaration' && statement.kind === 'const') {
      getDeclaredNames(statement).forEach((name) => constants.add(name));
    } else if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
      getDeclaredNames(statement).forEach((name) => constants.add(name));
    }
  }
  const index = body.findIndex(
    (statement) =>
      statement.type === 'ExportDefaultDeclaration' &&
      isIdentifier(statement.declaration) &&
      constants.has(statement.declaration.name as string),
  );
  if (index !== -1) {
    const statement = body[index];
    const local = statement.declaration as Node;
    body.splice(index, 1);
    const specifier = create('ExportSpecifier', statement, {
      local,
      exported: create('Identifier', local, { name: 'default' }),
      exportKind: 'value',
    });
    const list = body.find(
      (candidate) =>
        candidate.type === 'ExportNamedDeclaration' &&
        !candidate.declaration &&
        !candidate.source &&
        candidate.exportKind !== 'type',
    );
    if (list) {
      list.specifiers = [...(list.specifiers as Node[]), specifier];
      sortSpecifiers(list);
    } else {
      body.push(
        create('ExportNamedDeclaration', statement, {
          declaration: null,
          specifiers: [specifier],
          source: null,
          exportKind: 'value',
          attributes: [],
        }),
      );
    }
  }

  const references = countReferences(program);
  for (const list of body) {
    if (list.type !== 'ExportNamedDeclaration' || list.declaration || list.source) {
      continue;
    }
    const specifiers = list.specifiers as Node[];
    const specifier = specifiers.find((candidate) => getName(candidate.exported) === 'default');
    if (!specifier || !isIdentifier(specifier.local)) {
      continue;
    }
    const name = specifier.local.name as string;
    // The declaration and the export are its only uses
    if (references.get(name) !== 2) {
      continue;
    }
    const declarationIndex = body.findIndex(
      (statement) =>
        statement.type === 'VariableDeclaration' &&
        statement.kind !== 'let' &&
        (statement.declarations as Node[]).length === 1 &&
        isIdentifier((statement.declarations as Node[])[0].id, name),
    );
    if (declarationIndex === -1) {
      continue;
    }
    const declaration = body[declarationIndex];
    const init = (declaration.declarations as Node[])[0].init;
    if (!isNode(init)) {
      continue;
    }
    body[declarationIndex] = create('ExportDefaultDeclaration', declaration, {
      declaration: init,
      exportKind: 'value',
    });
    list.specifiers = specifiers.filter((candidate) => candidate !== specifier);
    if ((list.specifiers as Node[]).length === 0) {
      program.body = body.filter((statement) => statement !== list);
    }
    return;
  }
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
  for (const statement of program.body as Node[]) {
    // `export { a } from 'x'` names what another module exports, not a local binding
    if (statement.type === 'ExportNamedDeclaration' && statement.source) {
      for (const specifier of statement.specifiers as Node[]) {
        specifier.isReexport = true;
      }
    }
  }
  hoistExports(program, isDeclarationFile);
  renameBindings(program);
  if (!isDeclarationFile) {
    normalizeDefaultExport(program);
  }
  visit(program, isDeclarationFile);
}
