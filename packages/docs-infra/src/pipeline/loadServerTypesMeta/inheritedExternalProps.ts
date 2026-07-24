import ts from 'typescript';
import {
  CallSignature,
  Documentation,
  ExternalTypeNode,
  FunctionNode,
  IntrinsicNode,
  LiteralNode,
  Parameter,
  PropertyNode,
  TypeName,
  UnionNode,
} from 'typescript-api-extractor';
import type { AnyType, ComponentNode, ExportNode } from 'typescript-api-extractor';
import { isComponentType, isObjectType } from './typeGuards';

/**
 * Props to re-include for a single externally declared type. Either a list of
 * prop names, or an object that additionally pins the package the type must be
 * declared in — use the object form when another installed package could
 * declare a type with the same name.
 */
export type InheritedExternalPropsEntry =
  | string[]
  | {
      /** Name of the package the type must be declared in (e.g. `@base-ui/react`). */
      from: string;
      props: string[];
    };

/**
 * Props to re-include when they are inherited from externally declared types,
 * keyed by the name of the type (interface or type alias) that declares them.
 *
 * @example { BaseUIComponentProps: ['className', 'render', 'style'] }
 * @example { BaseUIComponentProps: { from: '@base-ui/react', props: ['className'] } }
 */
export interface InheritedExternalPropsConfig {
  [typeName: string]: InheritedExternalPropsEntry;
}

interface ResolvedConfigEntry {
  from?: string;
  props: string[];
}

function resolveConfig(config: InheritedExternalPropsConfig): Map<string, ResolvedConfigEntry> {
  return new Map(
    Object.entries(config).map(([typeName, entry]) => [
      typeName,
      Array.isArray(entry) ? { props: entry } : entry,
    ]),
  );
}

/** Bail out of type conversion once nesting gets deeper than any expected prop shape. */
const MAX_CONVERSION_DEPTH = 8;

/**
 * Re-adds configured props to parsed component exports when they are inherited
 * from a type declared in an installed package. typescript-api-extractor skips
 * properties that are only declared inside `node_modules` (which is what keeps
 * native DOM attributes out of the docs), so shared props that a library
 * inherits from another package's base props type silently disappear from its
 * prop tables. The synthesized nodes are built from the checker's resolved
 * types, so the output matches what the extractor produces when the same props
 * are declared locally.
 */
export function augmentComponentsWithInheritedProps(
  exports: ExportNode[],
  program: ts.Program,
  sourceFile: ts.SourceFile,
  config: InheritedExternalPropsConfig | undefined,
): void {
  if (!config || Object.keys(config).length === 0) {
    return;
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    return;
  }

  const symbolsByExportName = new Map<string, ts.Symbol>();
  collectExportSymbols(checker, moduleSymbol, [], symbolsByExportName, new Set());

  const exportNames = exports.map((exportNode) => exportNode.name);
  const resolvedConfig = resolveConfig(config);
  const propNames = new Set(Array.from(resolvedConfig.values()).flatMap((entry) => entry.props));

  for (const exportNode of exports) {
    if (!isComponentType(exportNode.type)) {
      continue;
    }

    const symbol = symbolsByExportName.get(exportNode.name);
    if (!symbol) {
      continue;
    }

    const propsType = getComponentPropsType(checker, symbol);
    if (!propsType) {
      continue;
    }

    const component = exportNode.type as ComponentNode;
    const existingNames = new Set(component.props.map((prop) => prop.name));
    const addedProps: PropertyNode[] = [];

    for (const propName of propNames) {
      if (existingNames.has(propName)) {
        continue;
      }

      const propSymbol = propsType.getProperty(propName);
      if (!propSymbol || !isInheritedExternalProp(propSymbol, propName, resolvedConfig)) {
        continue;
      }

      const propNode = createPropNode(propSymbol, checker, exportNames);
      if (propNode) {
        addedProps.push(propNode);
      }
    }

    if (addedProps.length === 0) {
      continue;
    }

    component.props.push(...addedProps);
    augmentPropsTypeExports(exports, exportNode, addedProps);
  }
}

/**
 * Mirrors the synthesized props onto the exported props type of the component
 * (both the namespaced `Component.Props` alias and the flat interface export),
 * so their rendered type definitions match the component's prop table.
 */
function augmentPropsTypeExports(
  exports: ExportNode[],
  componentExport: ExportNode,
  addedProps: PropertyNode[],
): void {
  const componentName = componentExport.name;
  const propsExportNames = new Set([
    `${componentName}.Props`,
    `${componentName.replaceAll('.', '')}Props`,
  ]);
  if (componentExport.reexportedFrom) {
    propsExportNames.add(`${componentExport.reexportedFrom}Props`);
  }

  for (const exportNode of exports) {
    if (!propsExportNames.has(exportNode.name) || !isObjectType(exportNode.type)) {
      continue;
    }
    const existingNames = new Set(exportNode.type.properties.map((prop) => prop.name));
    exportNode.type.properties.push(...addedProps.filter((prop) => !existingNames.has(prop.name)));
  }
}

/**
 * Maps parsed export names to their TypeScript symbols, using the same naming
 * scheme as typescript-api-extractor (namespace members become dotted names,
 * e.g. `Menu.Root`).
 */
function collectExportSymbols(
  checker: ts.TypeChecker,
  moduleSymbol: ts.Symbol,
  namespaces: string[],
  result: Map<string, ts.Symbol>,
  visited: Set<ts.Symbol>,
): void {
  if (namespaces.length > 2 || visited.has(moduleSymbol)) {
    return;
  }
  visited.add(moduleSymbol);

  for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = [...namespaces, exportSymbol.name].join('.');
    result.set(name, exportSymbol);

    // Recurse into `export * as Namespace from '...'` re-exports.
    const declaration = exportSymbol.declarations?.[0];
    if (declaration && ts.isNamespaceExport(declaration)) {
      const aliased = checker.getAliasedSymbol(exportSymbol);
      if (aliased) {
        collectExportSymbols(checker, aliased, [...namespaces, exportSymbol.name], result, visited);
      }
    }
  }
}

/**
 * Resolves the props type of a component export from its first call signature.
 */
function getComponentPropsType(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type | undefined {
  // eslint-disable-next-line no-bitwise
  const isAlias = (symbol.flags & ts.SymbolFlags.Alias) !== 0;
  const resolvedSymbol = isAlias ? checker.getAliasedSymbol(symbol) : symbol;
  const componentType = checker.getTypeOfSymbol(resolvedSymbol);

  for (const signature of componentType.getCallSignatures()) {
    const propsParameter = signature.parameters[0];
    const declaration = propsParameter?.valueDeclaration ?? propsParameter?.declarations?.[0];
    if (declaration) {
      return checker.getTypeOfSymbolAtLocation(propsParameter, declaration);
    }
  }

  return undefined;
}

/**
 * Checks that a prop is declared in an installed package on one of the
 * configured types (and, when configured, in the expected package). Locally
 * declared props are already handled by the extractor, and external props of
 * any other origin (e.g. native DOM attributes) must stay excluded from the
 * docs.
 */
function isInheritedExternalProp(
  propSymbol: ts.Symbol,
  propName: string,
  config: Map<string, ResolvedConfigEntry>,
): boolean {
  const declarations = propSymbol.declarations ?? [];
  if (declarations.length === 0) {
    return false;
  }

  return declarations.every((declaration) => {
    const fileName = declaration.getSourceFile().fileName;
    if (!fileName.includes('node_modules')) {
      return false;
    }
    const owner = ts.findAncestor(
      declaration,
      (node): node is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
        ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node),
    );
    const entry = owner && config.get(owner.name.text);
    if (!entry || !entry.props.includes(propName)) {
      return false;
    }
    return !entry.from || getPackageName(fileName) === entry.from;
  });
}

/**
 * Extracts the package name from a file path inside `node_modules`,
 * e.g. `.../node_modules/@base-ui/react/types.d.ts` → `@base-ui/react`.
 * Uses the last `node_modules` segment to handle nested installations.
 */
function getPackageName(fileName: string): string | undefined {
  const segments = fileName.split(/[\\/]/);
  const index = segments.lastIndexOf('node_modules');
  if (index === -1) {
    return undefined;
  }
  const first = segments[index + 1];
  if (!first) {
    return undefined;
  }
  if (first.startsWith('@')) {
    const second = segments[index + 2];
    return second ? `${first}/${second}` : undefined;
  }
  return first;
}

function createPropNode(
  propSymbol: ts.Symbol,
  checker: ts.TypeChecker,
  exportNames: readonly string[],
): PropertyNode | undefined {
  const declaration = propSymbol.valueDeclaration ?? propSymbol.declarations?.[0];
  if (!declaration) {
    return undefined;
  }

  const propType = checker.getTypeOfSymbolAtLocation(propSymbol, declaration);
  const description = ts.displayPartsToString(propSymbol.getDocumentationComment(checker));
  // eslint-disable-next-line no-bitwise
  const optional = (propSymbol.flags & ts.SymbolFlags.Optional) !== 0;

  return new PropertyNode(
    propSymbol.name,
    convertType(propType, checker, exportNames, 0),
    description ? new Documentation(description) : undefined,
    optional,
  );
}

/**
 * Converts a checker-resolved type into the extractor's type model, mirroring
 * how typescript-api-extractor represents locally declared props: intrinsics
 * and unions are expanded, anonymous function types are expanded into call
 * signatures, and named types become references.
 */
function convertType(
  type: ts.Type,
  checker: ts.TypeChecker,
  exportNames: readonly string[],
  depth: number,
): AnyType {
  if (depth > MAX_CONVERSION_DEPTH) {
    return new ExternalTypeNode(new TypeName(checker.typeToString(type)));
  }

  const intrinsic = getIntrinsicName(type);
  if (intrinsic) {
    return new IntrinsicNode(intrinsic);
  }

  // eslint-disable-next-line no-bitwise
  if ((type.flags & ts.TypeFlags.Literal) !== 0) {
    return new LiteralNode(checker.typeToString(type));
  }

  if (type.isUnion()) {
    return new UnionNode(
      undefined,
      type.types.map((member) => convertType(member, checker, exportNames, depth + 1)),
    );
  }

  const typeName = getNamedTypeReference(type, exportNames);
  const callSignatures = type.getCallSignatures();
  if (callSignatures.length > 0) {
    return new FunctionNode(
      typeName,
      callSignatures.map((signature) => convertSignature(signature, checker, exportNames, depth)),
    );
  }

  if (typeName) {
    return new ExternalTypeNode(typeName);
  }

  return new ExternalTypeNode(new TypeName(checker.typeToString(type)));
}

function convertSignature(
  signature: ts.Signature,
  checker: ts.TypeChecker,
  exportNames: readonly string[],
  depth: number,
): CallSignature {
  const parameters = signature.parameters.map((parameter) => {
    const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
    const parameterType = declaration
      ? checker.getTypeOfSymbolAtLocation(parameter, declaration)
      : checker.getTypeOfSymbol(parameter);
    const optional = Boolean(
      declaration &&
      ts.isParameter(declaration) &&
      (declaration.questionToken || declaration.initializer),
    );
    return new Parameter(
      convertType(parameterType, checker, exportNames, depth + 1),
      parameter.name,
      undefined,
      optional,
      undefined,
    );
  });

  return new CallSignature(
    parameters,
    convertType(signature.getReturnType(), checker, exportNames, depth + 1),
  );
}

type IntrinsicName = ConstructorParameters<typeof IntrinsicNode>[0];

const INTRINSIC_FLAGS: Array<[ts.TypeFlags, IntrinsicName]> = [
  [ts.TypeFlags.String, 'string'],
  [ts.TypeFlags.Number, 'number'],
  [ts.TypeFlags.Boolean, 'boolean'],
  [ts.TypeFlags.BigInt, 'bigint'],
  [ts.TypeFlags.Undefined, 'undefined'],
  [ts.TypeFlags.Null, 'null'],
  [ts.TypeFlags.Void, 'void'],
  [ts.TypeFlags.Any, 'any'],
  [ts.TypeFlags.Unknown, 'unknown'],
  [ts.TypeFlags.Never, 'never'],
];

function getIntrinsicName(type: ts.Type): IntrinsicName | undefined {
  // `boolean` is represented as a union of literals, so check it before unions.
  // eslint-disable-next-line no-bitwise
  const match = INTRINSIC_FLAGS.find(([flag]) => (type.flags & flag) !== 0);
  return match?.[1];
}

/**
 * Builds a reference for a named type, preferring the module's dotted export
 * name (e.g. `Menu.Root.State`) when one exists for the flat name.
 */
function getNamedTypeReference(
  type: ts.Type,
  exportNames: readonly string[],
): TypeName | undefined {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const name = symbol?.name;
  if (!symbol || !name || name.startsWith('__')) {
    return undefined;
  }

  // Collect enclosing namespaces (e.g. `React` for `React.CSSProperties`),
  // stopping at module/source-file symbols whose names are quoted paths.
  const namespaces: string[] = [];
  let parent = (symbol as { parent?: ts.Symbol }).parent;
  while (parent && /^[A-Za-z_$][\w$]*$/.test(parent.name)) {
    namespaces.unshift(parent.name);
    parent = (parent as { parent?: ts.Symbol }).parent;
  }

  const flatName = [...namespaces, name].join('');
  const dottedName = exportNames.find(
    (exportName) => exportName.includes('.') && exportName.replaceAll('.', '') === flatName,
  );
  if (dottedName) {
    const parts = dottedName.split('.');
    return new TypeName(parts[parts.length - 1], parts.slice(0, -1));
  }

  return new TypeName(name, namespaces.length > 0 ? namespaces : undefined);
}
