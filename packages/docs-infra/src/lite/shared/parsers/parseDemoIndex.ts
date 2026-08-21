import { parser as jsParser } from '@lezer/javascript';

const parser = jsParser.configure({ dialect: 'jsx ts' });

export interface RelativeImport {
  specifier: string;
  start: number;
  end: number;
}

/** How a variant component is imported in the demo index module. */
export interface DemoVariantImport {
  specifier: string;
  /** The component's export name in its module, or `'default'` for a default import. */
  importName: string;
}

/** The demo export and its variants (variant name to import info) found in an index module. */
export interface ParsedDemoModule {
  exportName: string;
  variants: Record<string, DemoVariantImport>;
}

/** Finds relative import/export specifiers and their quote-free source offsets. */
export function getRelativeImports(source: string): RelativeImport[] {
  const specifiers: RelativeImport[] = [];
  parser.parse(source).iterate({
    enter(node) {
      if (node.name !== 'ImportDeclaration' && node.name !== 'ExportDeclaration') {
        return undefined;
      }
      const string = node.node.getChild('String');
      if (string) {
        const specifier = source.slice(string.from + 1, string.to - 1);
        if (specifier.startsWith('.')) {
          specifiers.push({ specifier, start: string.from + 1, end: string.to - 1 });
        }
      }
      return false;
    },
  });
  return specifiers;
}

export function parseDemoIndex(source: string): ParsedDemoModule | null {
  const tree = parser.parse(source);
  const top = tree.topNode;
  const getSourceText = (node: { from: number; to: number }): string =>
    source.slice(node.from, node.to);

  // Default imports bind as a direct VariableDefinition child; named imports
  // sit inside an ImportGroup (`{ A, B as C }` binds A and C). An aliased
  // specifier's exported name is the VariableName preceding its binding.
  const imports: Record<string, DemoVariantImport> = {};

  for (const declaration of top.getChildren('ImportDeclaration')) {
    const string = declaration.getChild('String');
    if (!string) {
      continue;
    }
    const specifier = getSourceText(string).slice(1, -1);
    const binding = declaration.getChild('VariableDefinition');
    if (binding) {
      imports[getSourceText(binding)] = { specifier, importName: 'default' };
    }
    const group = declaration.getChild('ImportGroup');
    if (group) {
      let importedName: string | null = null;
      for (let child = group.firstChild; child; child = child.nextSibling) {
        if (child.name === 'VariableName') {
          importedName = getSourceText(child);
        } else if (child.name === 'VariableDefinition') {
          imports[getSourceText(child)] = {
            specifier,
            importName: importedName ?? getSourceText(child),
          };
          importedName = null;
        }
      }
    }
  }

  for (const exportDeclaration of top.getChildren('ExportDeclaration')) {
    const declaration = exportDeclaration.getChild('VariableDeclaration');
    const call = declaration?.getChild('CallExpression');
    const callee = call?.getChild('VariableName');
    const calleeName = callee ? getSourceText(callee) : '';
    if (calleeName !== 'createDemo' && calleeName !== 'createDemoWithVariants') {
      continue;
    }
    const exportBinding = declaration?.getChild('VariableDefinition');
    if (!exportBinding || !call) {
      continue;
    }
    const exportName = getSourceText(exportBinding);
    const argList = call.getChild('ArgList');

    const variants: Record<string, DemoVariantImport | undefined> = {};
    if (calleeName === 'createDemoWithVariants') {
      // createDemoWithVariants(import.meta.url, { Name } | { Name: Component }, options?)
      const object = argList?.getChild('ObjectExpression');
      if (!object) {
        return null;
      }
      for (const property of object.getChildren('Property')) {
        const key = property.getChild('PropertyDefinition');
        if (key) {
          const value = property.getChild('VariableName');
          variants[getSourceText(key)] = imports[value ? getSourceText(value) : getSourceText(key)];
        }
      }
    } else {
      // createDemo(import.meta.url, Component, options?): the component is
      // the first identifier argument (import.meta.url contains none).
      const component = argList?.getChild('VariableName');
      if (!component) {
        return null;
      }
      variants.Default = imports[getSourceText(component)];
    }

    const resolvedVariants: Record<string, DemoVariantImport> = {};
    for (const [variantName, variantImport] of Object.entries(variants)) {
      if (!variantImport) {
        throw new Error(
          `docs-infra: could not find the import for demo variant "${variantName}". ` +
            'Demo variants must be imported directly in the demo index file.',
        );
      }
      resolvedVariants[variantName] = variantImport;
    }
    return { exportName, variants: resolvedVariants };
  }
  return null;
}

/** Loader-facing alias for the parsed demo index contract. */
export const parseDemoModule = parseDemoIndex;
