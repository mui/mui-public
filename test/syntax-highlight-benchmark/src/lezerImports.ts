import type { SyntaxNode, Tree } from '@lezer/common';

export interface LezerImportName {
  name: string;
  alias?: string;
  type: 'default' | 'named' | 'namespace';
  isType?: boolean;
}

export interface LezerImport {
  source: string;
  names: LezerImportName[];
  /** Offsets of the module specifier, quotes included. */
  start: number;
  end: number;
  kind: 'import' | 'export' | 'dynamic';
}

export interface LezerComment {
  text: string;
  start: number;
  end: number;
}

function namesOf(group: SyntaxNode, source: string, groupIsType: boolean): LezerImportName[] {
  const names: LezerImportName[] = [];
  let isType = groupIsType;
  let pending: LezerImportName | undefined;
  let expectAlias = false;
  for (let child = group.firstChild; child; child = child.nextSibling) {
    const text = source.slice(child.from, child.to);
    if (child.name === 'type') {
      isType = true;
    } else if (child.name === 'as') {
      expectAlias = true;
    } else if (child.name === ',' || child.name === '}') {
      if (pending) {
        names.push(pending);
      }
      pending = undefined;
      isType = groupIsType;
    } else if (
      child.name === 'VariableName' ||
      child.name === 'VariableDefinition' ||
      child.name === 'default'
    ) {
      if (expectAlias && pending) {
        pending.alias = text;
        expectAlias = false;
      } else {
        pending = { name: text, type: 'named', ...(isType ? { isType: true } : {}) };
      }
    }
  }
  return names;
}

function declarationImport(node: SyntaxNode, source: string): LezerImport | undefined {
  const specifier = node.getChild('String');
  if (!specifier) {
    return undefined;
  }
  const names: LezerImportName[] = [];
  let isType = false;
  let afterStar = false;
  for (let child = node.firstChild; child && child !== specifier; child = child.nextSibling) {
    const text = source.slice(child.from, child.to);
    if (child.name === 'type') {
      isType = true;
    } else if (child.name === 'Star') {
      afterStar = true;
    } else if (child.name === 'VariableDefinition' || child.name === 'VariableName') {
      names.push({
        name: text,
        type: afterStar ? 'namespace' : 'default',
        ...(isType ? { isType: true } : {}),
      });
    } else if (child.name === 'ImportGroup' || child.name === 'ExportGroup') {
      names.push(...namesOf(child, source, isType));
    }
  }
  return {
    source: source.slice(specifier.from + 1, specifier.to - 1),
    names,
    start: specifier.from,
    end: specifier.to,
    kind: node.name === 'ImportDeclaration' ? 'import' : 'export',
  };
}

/**
 * Collects static imports, `export … from` re-exports, literal dynamic
 * `import()` calls and comments from a Lezer JavaScript/TypeScript tree.
 */
export function extractLezerImports(
  tree: Tree,
  source: string,
): { imports: LezerImport[]; comments: LezerComment[] } {
  const imports: LezerImport[] = [];
  const comments: LezerComment[] = [];
  tree.iterate({
    enter(ref) {
      switch (ref.name) {
        case 'ImportDeclaration':
        case 'ExportDeclaration': {
          const found = declarationImport(ref.node, source);
          if (!found) {
            // `export function …` and friends can still contain dynamic imports.
            return undefined;
          }
          imports.push(found);
          return false;
        }
        case 'DynamicImport': {
          const specifier = ref.node.getChild('String');
          if (specifier) {
            imports.push({
              source: source.slice(specifier.from + 1, specifier.to - 1),
              names: [],
              start: specifier.from,
              end: specifier.to,
              kind: 'dynamic',
            });
          }
          return false;
        }
        case 'LineComment':
        case 'BlockComment':
          comments.push({ text: source.slice(ref.from, ref.to), start: ref.from, end: ref.to });
          return false;
        default:
          return undefined;
      }
    },
  });
  return { imports, comments };
}
