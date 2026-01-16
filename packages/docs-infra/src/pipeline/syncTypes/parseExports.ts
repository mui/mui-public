import * as ts from 'typescript';
import type { Program, SourceFile, TypeChecker } from 'typescript';
import { parseFromProgram, type ExportNode, type ParserOptions } from 'typescript-api-extractor';

/**
 * Cleans dynamic import syntax from type strings.
 * TypeScript's typeToString can produce strings like:
 * - "import('/path/to/file').TypeName" -> "TypeName"
 * - "import('/path').A | import('/path').B" -> "A | B"
 * - "{ prop: import('/path').Type }" -> "{ prop: Type }"
 */
function cleanImportSyntax(typeString: string): string {
  // Replace all import('...').TypeName patterns with just TypeName
  return typeString.replace(/import\([^)]+\)\.(\w+)/g, '$1');
}

/**
 * Gets the order of union members from the source TypeNode.
 * TypeScript's type.types array doesn't preserve source order, but the TypeNode does.
 * This function extracts the source order so we can reorder expanded union members.
 */
function getUnionSourceOrder(typeNode: ts.TypeNode): string[] | undefined {
  if (!ts.isUnionTypeNode(typeNode)) {
    return undefined;
  }

  // Extract the text of each union member from the source
  return typeNode.types.map((member) => member.getText().trim());
}

/**
 * Reorders expanded union members to match source order.
 * @param expandedUnionStr - The expanded union string like "{ reason: 'a'; ... } | { reason: 'b'; ... }"
 * @param sourceOrder - The source order of union members (e.g., ['triggerPress', 'none'])
 * @returns The reordered union string
 */
function reorderUnionToMatchSource(
  expandedUnionStr: string,
  sourceOrder: string[] | undefined,
): string {
  if (!sourceOrder || sourceOrder.length === 0) {
    return expandedUnionStr;
  }

  // Split into top-level union members
  const expandedMembers = splitUnionAtTopLevel(expandedUnionStr);

  if (expandedMembers.length !== sourceOrder.length) {
    // If counts don't match, can't reliably reorder
    return expandedUnionStr;
  }

  // For discriminated unions (objects with 'reason' field), extract the reason value
  // For literal unions, extract the literal value
  const getMemberKey = (member: string): string => {
    // Check for discriminated union pattern: { reason: 'value'; ... }
    const reasonMatch = member.match(/reason:\s*['"]([^'"]+)['"]/);
    if (reasonMatch) {
      return reasonMatch[1];
    }

    // Check for literal value: 'value' or "value"
    const literalMatch = member.match(/^['"]([^'"]+)['"]$/);
    if (literalMatch) {
      return literalMatch[1];
    }

    // Return the whole member as key
    return member;
  };

  // Map source order keys to expanded members
  const memberByKey = new Map<string, string>();
  for (const member of expandedMembers) {
    const key = getMemberKey(member);
    memberByKey.set(key, member);
  }

  // Normalize source order keys (e.g., "typeof REASONS.triggerPress" -> "trigger-press")
  const normalizeKey = (key: string): string => {
    // Handle typeof REASONS.xxx patterns
    const reasonsMatch = key.match(/typeof\s+REASONS\.(\w+)/);
    if (reasonsMatch) {
      // Convert camelCase to kebab-case (triggerPress -> trigger-press)
      return reasonsMatch[1]
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
    }

    // Handle string literals
    const literalMatch = key.match(/^['"]([^'"]+)['"]$/);
    if (literalMatch) {
      return literalMatch[1];
    }

    return key;
  };

  // Reorder based on source order
  const reordered: string[] = [];
  for (const sourceKey of sourceOrder) {
    const normalizedKey = normalizeKey(sourceKey);
    const member = memberByKey.get(normalizedKey);
    if (member) {
      reordered.push(member);
      memberByKey.delete(normalizedKey);
    }
  }

  // Add any remaining members that weren't matched
  for (const member of Array.from(memberByKey.values())) {
    reordered.push(member);
  }

  return reordered.join(' | ');
}

type ReExportInfo = {
  sourceFile: SourceFile;
  aliasMap: Map<string, string>; // Maps original name -> exported name
  namespaceName?: string; // For `export * as X`
};

export type ParsedReExports = {
  name: string;
  exports: ExportNode[];
  typeNameMap: Map<string, string>; // Maps flat type names to dotted names
  isExternal?: boolean; // Flag for externally imported modules
  sourceFilePaths?: string[]; // Source file paths that were processed (for collecting adjacent files)
};

/**
 * Extracts namespace members from TypeScript namespace declarations.
 * For example, from `export namespace Component { export type State = ...; export type Props = ...; }`
 * returns Map { 'State' => 'ComponentState', 'Props' => 'ComponentProps' }
 */
function extractNamespaceMembers(sourceFile: SourceFile): Map<string, Map<string, string>> {
  const namespaceMembers = new Map<string, Map<string, string>>();

  function visit(node: ts.Node) {
    // Look for: export namespace ComponentName { ... }
    if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const namespaceName = node.name.text;
      const members = new Map<string, string>();

      if (node.body && ts.isModuleBlock(node.body)) {
        for (const statement of node.body.statements) {
          // Look for: export type MemberName = FlatTypeName
          if (
            ts.isTypeAliasDeclaration(statement) &&
            statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
          ) {
            const memberName = statement.name.text; // e.g., "State"

            // Extract the RHS of the type alias (e.g., "MenuRadioItemState")
            // from "export type State = MenuRadioItemState"
            if (statement.type && ts.isTypeReferenceNode(statement.type)) {
              const typeName = statement.type.typeName;
              if (ts.isIdentifier(typeName)) {
                const flatTypeName = typeName.text; // e.g., "MenuRadioItemState"
                members.set(memberName, flatTypeName);
              }
            }
          }
        }
      }

      if (members.size > 0) {
        namespaceMembers.set(namespaceName, members);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return namespaceMembers;
}

/**
 * Helper to split a union type string into its top-level variants.
 * This correctly handles nested unions by tracking brace depth.
 *
 * For example:
 * Input: "{ a: X | Y; } | { b: Z; }"
 * Output: ["{ a: X | Y; }", "{ b: Z; }"]
 */
function splitUnionAtTopLevel(unionStr: string): string[] {
  const variants: string[] = [];
  let current = '';
  let braceDepth = 0;
  let parenDepth = 0;

  for (let i = 0; i < unionStr.length; i += 1) {
    const char = unionStr[i];
    const nextChar = unionStr[i + 1];

    // Track nesting depth
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth -= 1;
    } else if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
    }

    // Check if this is a top-level union separator
    if (char === '|' && braceDepth === 0 && parenDepth === 0 && nextChar === ' ') {
      // We found a top-level separator
      variants.push(current.trim());
      current = '';
      i += 1; // Skip the space after |
      continue;
    }

    current += char;
  }

  // Add the last variant
  if (current.trim()) {
    variants.push(current.trim());
  }

  return variants;
}

/**
 * Helper to fully expand intersection types by merging their properties.
 * TypeScript's typeToString doesn't merge intersection types like "A & B" into a single object.
 * This function detects intersection types and manually merges them.
 */
function expandIntersectionType(
  type: ts.Type,
  checker: TypeChecker,
  statement: ts.Node,
  flags: ts.TypeFormatFlags,
): string {
  // Check if this is an intersection type
  if (type.isIntersection()) {
    // For each type in the intersection, expand it fully
    // We need to use a special approach: convert each part using the same flags,
    // but also check if it's a union type (discriminated union) that we can merge
    const expandedTypes: string[] = [];
    let hasDiscriminatedUnion = false;
    let unionTypeStr: string | undefined;

    for (let i = 0; i < type.types.length; i += 1) {
      const t = type.types[i];

      // Recursively expand in case there are nested intersections
      const typeStr = expandIntersectionType(t, checker, statement, flags);

      expandedTypes.push(typeStr);

      // Check if this part is a discriminated union (contains multiple "{ reason:" variants)
      if (typeStr.includes('{ reason:') && typeStr.includes(' | ')) {
        hasDiscriminatedUnion = true;
        unionTypeStr = typeStr;
      }
    }

    if (hasDiscriminatedUnion && unionTypeStr && expandedTypes.length === 2) {
      // Find the other type (the one that's not the union)
      const additionalPropsType = expandedTypes.find((t) => t !== unionTypeStr);

      if (additionalPropsType && additionalPropsType.trim().startsWith('{')) {
        // Extract just the additional properties from the object (remove outer braces)
        const additionalPropsInner = additionalPropsType
          .trim()
          .replace(/^\{/, '')
          .replace(/\}$/, '')
          .trim();

        // Split the union into individual variants
        const variants = unionTypeStr.split(' | ').map((v) => v.trim());

        // Add the additional props to each variant
        const mergedVariants = variants.map((variant) => {
          // Remove trailing } and add the additional props
          const withoutClosing = variant.replace(/\s*\}\s*$/, '');
          return `${withoutClosing}; ${additionalPropsInner}; }`;
        });

        const result = mergedVariants.join(' | ');
        return result;
      }
    }

    // If we can't merge, just return the intersection as-is
    return cleanImportSyntax(checker.typeToString(type, statement, flags));
  }

  // Check if this is a union type (which we also want to expand fully)
  if (type.isUnion()) {
    // Let TypeScript handle the union expansion
    return cleanImportSyntax(checker.typeToString(type, statement, flags));
  }

  // Not an intersection or union, just convert to string
  return cleanImportSyntax(checker.typeToString(type, statement, flags));
}

/**
 * WORKAROUND: typescript-api-extractor doesn't support `export type` declarations.
 * This function extracts a type alias as a serializable structure that can be processed later.
 *
 * Instead of creating an ExportNode with TypeScript Type objects (which can't be serialized),
 * we store the AST node information that can be processed during HAST formatting on the main thread.
 *
 * @param typeName - The name of the type to extract
 * @param statement - The TypeAliasDeclaration node
 * @param sourceFile - The source file containing the declaration
 * @returns A minimal serializable export structure
 *
 * TODO: Remove this workaround when typescript-api-extractor adds support for type aliases.
 */
function extractTypeAliasAsExportNode(
  typeName: string,
  statement: ts.TypeAliasDeclaration,
  sourceFile: SourceFile,
  checker: TypeChecker,
): ExportNode | undefined {
  // Get the basic type text
  const typeText = statement.type.getText(sourceFile);

  // Check if the AST node itself is an intersection type
  const isIntersectionNode = ts.isIntersectionTypeNode(statement.type);

  // Extract source order from the type for reordering expanded unions
  // This handles cases like BaseUIChangeEventDetails<Reason> where Reason is a union
  let unionSourceOrder: string[] | undefined;

  /**
   * Helper to recursively resolve a type alias to find the underlying union source order.
   * Follows type reference chains like:
   *   AccordionRoot.ChangeEventReason -> AccordionRootChangeEventReason -> typeof REASONS.x | typeof REASONS.y
   */
  const getUnionSourceOrderFromTypeNode = (
    typeNode: ts.TypeNode,
    maxDepth = 5,
  ): string[] | undefined => {
    if (maxDepth <= 0) {
      return undefined;
    }

    // If it's a union type node, extract the order directly
    if (ts.isUnionTypeNode(typeNode)) {
      return getUnionSourceOrder(typeNode);
    }

    // If it's a type reference, resolve it
    if (ts.isTypeReferenceNode(typeNode)) {
      let symbol = checker.getSymbolAtLocation(typeNode.typeName);

      // For qualified names like AccordionRoot.ChangeEventReason, we need to resolve
      // the entire qualified name, not just the leftmost part
      if (!symbol && ts.isQualifiedName(typeNode.typeName)) {
        // Try to get the symbol of the full qualified name
        const fullType = checker.getTypeAtLocation(typeNode);
        symbol = fullType.aliasSymbol || fullType.symbol;
      }

      if (symbol) {
        // Follow alias chain
        // eslint-disable-next-line no-bitwise
        const targetSymbol =
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        const decls = targetSymbol.declarations;
        if (decls && decls.length > 0) {
          const decl = decls[0];
          if (ts.isTypeAliasDeclaration(decl)) {
            // Recursively resolve the type alias's type
            return getUnionSourceOrderFromTypeNode(decl.type, maxDepth - 1);
          }
        }
      }
    }

    return undefined;
  };

  // For type references like BaseUIChangeEventDetails<Reason>, get the order of the type argument
  if (ts.isTypeReferenceNode(statement.type) && statement.type.typeArguments) {
    const firstArg = statement.type.typeArguments[0];
    if (firstArg) {
      unionSourceOrder = getUnionSourceOrderFromTypeNode(firstArg);
    }
  } else {
    // Direct union type (not a type reference)
    unionSourceOrder = getUnionSourceOrder(statement.type);
  }

  // Try to get the expanded type using TypeChecker
  let expandedTypeText: string | undefined;
  try {
    const type = checker.getTypeAtLocation(statement.type);
    if (type) {
      // Use multiple flags to force full expansion of type aliases, generics, and intersections
      // This ensures that types like "DialogRootChangeEventReason" expand to their union
      // and intersection types like "A & B" merge into a single object type
      const flags =
        ts.TypeFormatFlags.NoTruncation +
        ts.TypeFormatFlags.InTypeAlias +
        ts.TypeFormatFlags.WriteArrayAsGenericType +
        ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

      // Try to expand the type
      expandedTypeText = cleanImportSyntax(checker.typeToString(type, statement, flags));

      // AGGRESSIVE EXPANSION: If the result is still a type alias name (e.g., "ToastObjectType<Data>"),
      // recursively follow the alias chain until we reach an interface/object type
      if (type.aliasSymbol) {
        let currentType = type;
        let iterations = 0;
        const maxIterations = 10; // Prevent infinite loops
        const seenSymbols = new Set<ts.Symbol>();

        while (currentType.aliasSymbol && iterations < maxIterations) {
          iterations += 1;

          // Prevent infinite loops by tracking seen symbols
          if (seenSymbols.has(currentType.aliasSymbol)) {
            break;
          }
          seenSymbols.add(currentType.aliasSymbol);

          const aliasDeclarations = currentType.aliasSymbol.getDeclarations();
          if (!aliasDeclarations || aliasDeclarations.length === 0) {
            break;
          }

          const aliasDecl = aliasDeclarations[0];

          if (ts.isTypeAliasDeclaration(aliasDecl) && aliasDecl.type) {
            // Get the symbol from the type being aliased (for type references)
            let nextType: ts.Type;

            if (ts.isTypeReferenceNode(aliasDecl.type)) {
              // It's a reference to another type - get the target symbol
              const referencedSymbol = checker.getSymbolAtLocation(aliasDecl.type.typeName);
              if (referencedSymbol) {
                nextType = checker.getDeclaredTypeOfSymbol(referencedSymbol);
              } else {
                nextType = checker.getTypeAtLocation(aliasDecl.type);
              }
            } else {
              // Not a type reference, just get the type
              nextType = checker.getTypeAtLocation(aliasDecl.type);
            }

            currentType = nextType;
          } else {
            break;
          }
        }

        if (iterations > 0) {
          // We followed at least one alias, try to expand the final type
          // TypeScript often refuses to expand interface names even after following aliases
          // So we need to check if it's an object type and manually expand its properties

          const furtherExpanded = cleanImportSyntax(
            checker.typeToString(currentType, statement, flags),
          );

          // Check if it's an object type that we can expand manually
          // Only do this for actual object types (not primitives like string, number, unions, etc.)
          // Also skip React built-in types which are better left as-is
          /* eslint-disable no-bitwise */
          const isObjectType = !!(currentType.flags & ts.TypeFlags.Object);
          const isNotUnion = !(currentType.flags & ts.TypeFlags.Union);
          const isNotPrimitive = !(
            currentType.flags &
            (ts.TypeFlags.String |
              ts.TypeFlags.Number |
              ts.TypeFlags.Boolean |
              ts.TypeFlags.StringLiteral |
              ts.TypeFlags.NumberLiteral |
              ts.TypeFlags.BooleanLiteral)
          );
          /* eslint-enable no-bitwise */
          // Don't expand React.* types - they're well-known and expanding them is too verbose
          const isNotReactType =
            !furtherExpanded.includes('React.') &&
            !furtherExpanded.includes('ReactElement') &&
            !furtherExpanded.includes('ReactNode') &&
            !furtherExpanded.includes('AwaitedReactNode');

          if (
            !furtherExpanded.startsWith('{') &&
            isObjectType &&
            isNotUnion &&
            isNotPrimitive &&
            isNotReactType &&
            currentType.getProperties
          ) {
            const props = currentType.getProperties();

            if (props.length > 0) {
              // Manually construct the object type string
              const propStrings = props.map((prop) => {
                const propType = checker.getTypeOfSymbolAtLocation(prop, statement);
                // Use None flags for properties to avoid expanding React.ReactNode and similar types
                const propTypeString = cleanImportSyntax(
                  checker.typeToString(propType, statement, ts.TypeFormatFlags.None),
                );
                // eslint-disable-next-line no-bitwise
                const optional = prop.flags & ts.SymbolFlags.Optional ? '?' : '';
                return `${prop.name}${optional}: ${propTypeString}`;
              });

              const manuallyExpanded = `{ ${propStrings.join('; ')}; }`;

              if (manuallyExpanded !== expandedTypeText) {
                expandedTypeText = manuallyExpanded;
              }
            }
          } else if (furtherExpanded !== expandedTypeText && furtherExpanded.startsWith('{')) {
            expandedTypeText = furtherExpanded;
          }
        }
      }

      // EXPAND MAPPED TYPES WITH INDEXED ACCESS:
      // Types like `{ [K in Reason]: { ... } }[Reason]` should be expanded to show all variants
      // This handles BaseUIChangeEventDetails when it's NOT in an intersection
      if (
        expandedTypeText &&
        expandedTypeText.includes('[K in ') &&
        expandedTypeText.match(/\}\s*\[\w+\]\s*$/)
      ) {
        // The mapped type has already been partially expanded by InTypeAlias flag
        // But TypeScript doesn't expand the union - it keeps the mapped type syntax
        // We need to use the type checker to get the actual union members

        // The type object should have the union members available
        if (type.isUnion && type.isUnion()) {
          const unionParts = type.types.map((t) =>
            cleanImportSyntax(checker.typeToString(t, statement, flags)),
          );
          expandedTypeText = unionParts.join(' | ');
        }
      }

      // HANDLE INTERSECTION TYPES AT AST LEVEL:
      // When the AST node is an intersection type, we need to expand each part separately
      // This is necessary for generic intersections like BaseUIChangeEventDetails<T> & { additional }
      if (isIntersectionNode && ts.isIntersectionTypeNode(statement.type)) {
        const intersectionNode = statement.type as ts.IntersectionTypeNode;
        const intersectionParts = intersectionNode.types;

        // Expand each part individually
        const expandedParts: string[] = [];
        for (let i = 0; i < intersectionParts.length; i += 1) {
          const partNode = intersectionParts[i];
          const partType = checker.getTypeAtLocation(partNode);
          const partStr = cleanImportSyntax(checker.typeToString(partType, statement, flags));
          expandedParts.push(partStr);
        }

        // Check if we have a discriminated union and additional props to merge
        const unionPart = expandedParts.find((p) => p.includes('{ reason:') && p.includes(' | '));
        const objectPart = expandedParts.find((p) => p !== unionPart && p.startsWith('{'));

        if (unionPart && objectPart) {
          // Extract additional props (without outer braces and trailing semicolons)
          const additionalPropsInner = objectPart
            .trim()
            .replace(/^\{/, '')
            .replace(/\}$/, '')
            .replace(/;+\s*$/, '') // Remove trailing semicolons
            .trim();

          // Split union into individual variants using top-level splitting
          const variants = splitUnionAtTopLevel(unionPart);

          // Merge additional props into each variant
          const mergedVariants = variants.map((variant) => {
            // Remove trailing semicolons and closing brace
            const withoutClosing = variant.replace(/;*\s*\}\s*$/, '').trim();
            // Add additional props with proper formatting
            return `${withoutClosing}; ${additionalPropsInner}; }`;
          });

          expandedTypeText = mergedVariants.join(' | ');
        } else {
          // No discriminated union found, just join the parts
          expandedTypeText = expandedParts.join(' & ');
        }
      } else if (!expandedTypeText) {
        // Not an intersection node and not yet expanded, use standard expansion
        expandedTypeText = expandIntersectionType(type, checker, statement, flags);
      }

      // Apply source order to expanded union if we have the order
      if (expandedTypeText && unionSourceOrder && expandedTypeText.includes(' | ')) {
        if (typeName.includes('ChangeEventDetails')) {
          console.warn(
            `[DEBUG] ${typeName}: reordering union. sourceOrder = ${JSON.stringify(unionSourceOrder)}`,
          );
          console.warn(`[DEBUG] Before: ${expandedTypeText.slice(0, 100)}...`);
        }
        expandedTypeText = reorderUnionToMatchSource(expandedTypeText, unionSourceOrder);
        if (typeName.includes('ChangeEventDetails')) {
          console.warn(`[DEBUG] After: ${expandedTypeText.slice(0, 100)}...`);
        }
      } else if (typeName.includes('ChangeEventDetails')) {
        console.warn(
          `[DEBUG] ${typeName}: NOT reordering. expandedTypeText=${!!expandedTypeText}, unionSourceOrder=${JSON.stringify(unionSourceOrder)}, hasUnion=${expandedTypeText?.includes(' | ')}`,
        );
      }
    }
  } catch (err) {
    // If expansion fails, we'll just use the basic typeText
    console.warn(`[extractTypeAliasAsExportNode] Failed to expand type for ${typeName}:`, err);
  }

  // Create an ExportNode-like structure with serializable data
  // The 'type' field will be a special marker that the formatting code recognizes
  const exportNode: any = {
    name: typeName,
    type: {
      kind: 'typeAlias',
      typeText, // Store as string for serialization
      expandedTypeText, // Expanded version if available
      // Store type parameters for display (e.g., "<Data>")
      typeParameters: statement.typeParameters
        ? `<${statement.typeParameters.map((tp) => tp.getText(sourceFile)).join(', ')}>`
        : undefined,
      fileName: sourceFile.fileName,
      position: statement.getStart(sourceFile),
    },
    documentation: undefined,
  };

  return exportNode as ExportNode;
}

export function parseExports(
  sourceFile: SourceFile,
  checker: TypeChecker,
  program: Program,
  parserOptions: ParserOptions,
  visited: Set<string> = new Set(),
  parentNamespaceName?: string,
  _isWorkerContext = true, // Kept for potential future use
): ParsedReExports[] {
  const fileName = sourceFile.fileName;

  // Prevent infinite recursion
  if (visited.has(fileName)) {
    return [];
  }
  visited.add(fileName);

  const allResults: ParsedReExports[] = [];
  const sourceFileSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  const exportedSymbols = sourceFileSymbol && checker.getExportsOfModule(sourceFileSymbol);

  if (!exportedSymbols) {
    return [];
  }

  const reExportInfos: ReExportInfo[] = [];

  // First, check for `export *` declarations at the statement level
  // These are barrel exports that re-export everything from another module
  sourceFile.statements.forEach((statement) => {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !statement.exportClause // `export *` has no exportClause
    ) {
      // This is an `export * from './file'` statement
      const importedSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
      const importedSourceFile = importedSymbol?.valueDeclaration?.getSourceFile();

      if (importedSourceFile) {
        reExportInfos.push({
          sourceFile: importedSourceFile,
          aliasMap: new Map(), // No aliasing for `export *`
        });
      }
    }
  });

  // Check each exported symbol
  exportedSymbols.forEach((symbol) => {
    const declarations = symbol.declarations;

    if (!declarations || declarations.length === 0) {
      return;
    }

    // Look for a NamespaceExport in any of the declarations
    const namespaceExportDecl = declarations.find((d) => ts.isNamespaceExport(d));
    const exportSpecifierDecl = declarations.find((d) => ts.isExportSpecifier(d));

    // Check if it's a NamespaceExport (like `export * as Component from './index.parts'`)
    // This should be checked FIRST because TypeScript creates synthetic ExportSpecifiers
    // for namespace exports, which don't have a moduleSpecifier
    if (namespaceExportDecl) {
      const exportDecl = namespaceExportDecl.parent;

      if (ts.isExportDeclaration(exportDecl) && exportDecl.moduleSpecifier) {
        const moduleSpecifier = exportDecl.moduleSpecifier;

        if (ts.isStringLiteral(moduleSpecifier)) {
          // Get the source file of the module being re-exported
          const importedSymbol = checker.getSymbolAtLocation(moduleSpecifier);
          const importedSourceFile = importedSymbol?.valueDeclaration?.getSourceFile();

          if (importedSourceFile) {
            const namespaceName = symbol.name;

            // For namespace exports, store the namespace name
            reExportInfos.push({
              sourceFile: importedSourceFile,
              aliasMap: new Map(),
              namespaceName,
            });
          }
        }
      }
    }
    // Check if it's an ExportSpecifier (like `export { X as Y } from './file'`)
    // Note: NamespaceExports create synthetic ExportSpecifiers, so we check NamespaceExport first
    else if (exportSpecifierDecl) {
      const exportDecl = exportSpecifierDecl.parent.parent;
      if (ts.isExportDeclaration(exportDecl) && exportDecl.moduleSpecifier) {
        const moduleSpecifier = exportDecl.moduleSpecifier;

        if (ts.isStringLiteral(moduleSpecifier)) {
          // Resolve the imported module to get its source file
          const resolvedModule = checker.getSymbolAtLocation(moduleSpecifier);
          const importedSourceFile = resolvedModule?.declarations?.[0]?.getSourceFile();

          if (importedSourceFile) {
            // Get the original name (before 'as') and the exported name (after 'as' or same if no alias)
            const originalName =
              exportSpecifierDecl.propertyName?.getText() || exportSpecifierDecl.name.getText();
            const exportedName = symbol.name;

            // Find or create the reExportInfo for this source file
            let reExportInfo = reExportInfos.find((info) => info.sourceFile === importedSourceFile);
            if (!reExportInfo) {
              reExportInfo = {
                sourceFile: importedSourceFile,
                aliasMap: new Map(),
                // Do NOT inherit parent namespace - it will be added later during namespace processing
              };
              reExportInfos.push(reExportInfo);
            }

            // Store the alias mapping
            reExportInfo.aliasMap.set(originalName, exportedName);
          }
        }
      } else {
        // When we have an ExportSpecifier without a moduleSpecifier, it could be from:
        // 1. A transformed namespace export (export * as X) compiled to JS
        // 2. A regular export from the same file
        // We need to trace the symbol to find its actual source

        // Try to find the actual source by looking at the aliased symbol
        const aliasedSymbol = checker.getAliasedSymbol(symbol);

        if (aliasedSymbol && aliasedSymbol !== symbol) {
          const aliasedDeclarations = aliasedSymbol.declarations;

          if (aliasedDeclarations && aliasedDeclarations.length > 0) {
            const aliasedSourceFile = aliasedDeclarations[0].getSourceFile();

            // This is likely a namespace import that was re-exported
            // We should process the aliased source file
            reExportInfos.push({
              sourceFile: aliasedSourceFile,
              aliasMap: new Map(),
              namespaceName: symbol.name,
            });
          }
        }
      }
    }
  });

  // If there are re-exports, recursively process them
  if (reExportInfos.length > 0) {
    // Check if any re-export has a namespace - if so, collect its aliases to share with type exports
    const namespaceReExport = reExportInfos.find((info) => info.namespaceName);
    let sharedAliasMap: Map<string, string> | undefined;
    let filteredReExportInfos = reExportInfos;

    // If we have a namespace export, ONLY process that one and skip type-only re-exports
    // This prevents duplicate processing when we have both `export * as Name` and `export type *`
    if (namespaceReExport) {
      sharedAliasMap = new Map();

      // Parse the namespace module's export statements to get aliases
      // e.g., `export { ComponentRoot as Root }` creates ComponentRoot -> Root
      namespaceReExport.sourceFile.statements.forEach((stmt) => {
        if (
          ts.isExportDeclaration(stmt) &&
          stmt.exportClause &&
          ts.isNamedExports(stmt.exportClause)
        ) {
          stmt.exportClause.elements.forEach((element) => {
            const originalName = (element.propertyName || element.name).text;
            const exportedName = element.name.text;
            sharedAliasMap!.set(originalName, exportedName);
          });
        }
      });

      // Filter to ONLY the namespace export - skip any direct type-only re-exports
      // that are already included in the namespace export's recursive processing
      filteredReExportInfos = [namespaceReExport];
    }

    for (const reExportInfo of filteredReExportInfos) {
      // Clone the visited set for each re-export branch to avoid cross-contamination
      // This allows the same file (e.g., MenuRoot.tsx) to be processed from different
      // parent contexts (e.g., Menu and ContextMenu) which may have different alias mappings
      const branchVisited = new Set(visited);

      const recursiveResults = parseExports(
        reExportInfo.sourceFile,
        checker,
        program,
        parserOptions,
        branchVisited, // Use cloned visited set instead of shared one
        reExportInfo.namespaceName, // Pass namespace context to child calls
        true, // isWorkerContext - recursive calls inherit the context
      );

      if (reExportInfo.namespaceName) {
        // For namespace exports, collect all exports from all recursive results
        // and prefix them with the namespace name
        // e.g., ButtonRootProps becomes Button.Root.Props in the Button namespace
        const allNamespaceExports: ExportNode[] = [];

        // Use the reExportInfo's aliasMap if it has one, otherwise use the shared alias map
        const aliasMap = reExportInfo.aliasMap.size > 0 ? reExportInfo.aliasMap : sharedAliasMap;

        // Filter out identity mappings (e.g., Separator → Separator) to prevent incorrect transformations
        // Identity mappings occur when a component re-exports another component without renaming
        const filteredAliasMap = aliasMap
          ? new Map(Array.from(aliasMap.entries()).filter(([key, value]) => key !== value))
          : undefined;

        // If after filtering we have no mappings left, set to undefined
        const effectiveAliasMap =
          filteredAliasMap && filteredAliasMap.size > 0 ? filteredAliasMap : undefined;

        for (const recursiveResult of recursiveResults) {
          for (const exportNode of recursiveResult.exports) {
            // Store the original name before any transformations for DataAttributes/CssVars lookup
            // This is especially important for re-exported components (e.g., MenuBackdrop -> ContextMenu.Backdrop)
            // where the DataAttributes file uses the original name (MenuBackdropDataAttributes)
            if (!(exportNode as any).originalName) {
              (exportNode as any).originalName = exportNode.name;
            }

            // Extract the base component name and suffix from the export name
            // e.g., "ButtonRootProps" -> base: "ButtonRoot", suffix: "Props"
            // We need to transform this to "Button.Root.Props" where:
            // - "Button" is the namespace name from reExportInfo
            // - "Root" comes from the alias map (ButtonRoot -> Root)
            // - "Props" is the suffix

            const namespaceName = reExportInfo.namespaceName;
            const exportName = exportNode.name;

            // Try to find a matching component name in the alias map
            // e.g., "ButtonRootProps" -> find "ButtonRoot" -> get alias "Root" -> suffix "Props"
            let transformedName = exportName;

            // Check each alias to see if the export name starts with the original component name
            if (effectiveAliasMap && effectiveAliasMap.size > 0) {
              effectiveAliasMap.forEach((aliasedName, originalName) => {
                if (transformedName === exportName && exportNode.name.startsWith(originalName)) {
                  // Found a match - split the name into component and suffix
                  const suffix = exportName.slice(originalName.length);

                  // Build the transformed name: Namespace.Alias.Suffix
                  // e.g., "Button" + "Root" + "Props" = "Button.Root.Props"
                  if (suffix) {
                    transformedName = `${namespaceName}.${aliasedName}.${suffix}`;
                  } else {
                    // No suffix - just the component name
                    transformedName = `${namespaceName}.${aliasedName}`;
                  }
                }
              });
            }

            // If no alias match found, add namespace prefix
            // The originalName (stored above) preserves the name before any aliasing,
            // so we can use it directly for lookups later
            if (transformedName === exportName) {
              if (exportName.startsWith(namespaceName)) {
                // Export already starts with namespace (e.g., "AutocompleteRootProps")
                // Remove namespace prefix and re-add with dots
                const withoutNamespace = exportName.slice(namespaceName.length);
                if (withoutNamespace) {
                  // Remove leading dot if present (e.g., ".Separator.Props" -> "Separator.Props")
                  // This prevents double dots like "Select..Separator.Props"
                  const cleanedSuffix = withoutNamespace.startsWith('.')
                    ? withoutNamespace.slice(1)
                    : withoutNamespace;

                  // IMPORTANT: Only transform if there's a corresponding alias in the map
                  // for a related component. This prevents standalone types like "ToastManager"
                  // from becoming "Toast.Manager" when they're not actually namespace members.
                  //
                  // For example:
                  // - "ToastRoot" has alias "ToastRoot" → "Root", so "ToastRootProps" → "Toast.Root.Props" ✓
                  // - "ToastManager" has NO alias, so it stays as "ToastManager" ✓
                  //
                  // Check if ANY alias in the map would match a prefix of the export name.
                  // If no alias matches, this type is likely a standalone export that just
                  // happens to share a prefix with the namespace name.
                  let hasMatchingAlias = false;
                  if (effectiveAliasMap && effectiveAliasMap.size > 0) {
                    effectiveAliasMap.forEach((_, originalName) => {
                      if (exportName.startsWith(originalName)) {
                        hasMatchingAlias = true;
                      }
                    });
                  }

                  // Only transform if there's a matching alias (component was explicitly re-exported)
                  // OR if the suffix contains a dot (already a nested type like "Component.Props")
                  if (hasMatchingAlias || cleanedSuffix.includes('.')) {
                    transformedName = `${namespaceName}.${cleanedSuffix}`;
                  }
                  // else: No matching alias found, keep the original name (e.g., "ToastManager" stays "ToastManager")
                }
              } else if (exportName.includes('.')) {
                // Export is already dotted (e.g., "Separator.Props" from namespace member)
                // Special case: if exportName starts with a dot (e.g., ".Props"), it's a bare member
                // that needs a component name prepended, which should come from the member map

                if (exportName.startsWith('.')) {
                  // This is a bare namespace member like ".Props"
                  // Just add the namespace prefix directly
                  transformedName = `${namespaceName}${exportName}`;
                } else {
                  // Normal dotted name like "Separator.Props"
                  // This could be:
                  // 1. Component.Member where Component is the ALIASED name (e.g., "Separator.Props" where "Separator" is the alias for "SelectSeparator")
                  // 2. Component.Member where Component is not aliased

                  // Split the export name at the first dot
                  const firstDotIndex = exportName.indexOf('.');
                  const componentPart = exportName.slice(0, firstDotIndex);
                  const memberPart = exportName.slice(firstDotIndex); // includes the dot

                  // Check if componentPart is already an alias (i.e., it's a VALUE in the map)
                  // For example, "Separator.Props" where "Separator" is the alias for "SelectSeparator"
                  // In this case, "Separator" is the SHORT name, so we need to add the namespace
                  // but NOT treat componentPart as needing transformation
                  const isAlreadyAliased = effectiveAliasMap
                    ? Array.from(effectiveAliasMap.values()).includes(componentPart)
                    : false;

                  if (isAlreadyAliased) {
                    // The component part is already an alias (short name), so just add namespace
                    // e.g., "Separator.Props" → "Select.Separator.Props" (NOT "Select.Separator..Props")
                    transformedName = `${namespaceName}.${exportName}`;
                  } else {
                    // Not an alias - check if there's an alias mapping for this component
                    let aliasedComponentPart = componentPart;
                    if (effectiveAliasMap && effectiveAliasMap.has(componentPart)) {
                      aliasedComponentPart = effectiveAliasMap.get(componentPart)!;
                    }

                    // Reconstruct: Namespace.AliasedComponent.Member
                    transformedName = `${namespaceName}.${aliasedComponentPart}${memberPart}`;
                  }
                }
              } else {
                // Export is a flat name - just add namespace prefix
                transformedName = `${namespaceName}.${exportName}`;
              }
            }

            exportNode.name = transformedName;
            allNamespaceExports.push(exportNode);
          }
        }

        // Merge typeNameMaps from all component files and transform with namespace prefix
        const mergedTypeNameMap = new Map<string, string>();
        const namespace = reExportInfo.namespaceName;

        for (const result of recursiveResults) {
          if (result.typeNameMap) {
            Array.from(result.typeNameMap.entries()).forEach(([flatName, dottedName]) => {
              // Transform the dotted name to replace source namespace with target namespace
              // E.g., when ContextMenu re-exports from Menu:
              //   "Menu.Backdrop.State" -> "ContextMenu.Backdrop.State"
              // OR when ContextMenu re-exports MenuBackdrop as Backdrop:
              //   "MenuBackdrop.State" -> "Backdrop.State" -> "ContextMenu.Backdrop.State"
              const parts = dottedName.split('.');
              const componentPart = parts[0]; // e.g., "Menu", "MenuBackdrop", or "ToolbarRoot"
              let transformedComponentPart = componentPart;

              // Apply alias transformations to the component part ONLY
              // This handles: MenuBackdrop -> Backdrop, ToolbarRoot -> Root, etc.
              if (aliasMap) {
                aliasMap.forEach((aliasedName, originalName) => {
                  // Match exact component name OR component name with suffix (MenuRadioItem matches Menu)
                  if (componentPart === originalName) {
                    // Exact match: MenuBackdrop -> Backdrop
                    transformedComponentPart = aliasedName;
                  } else if (componentPart.startsWith(originalName)) {
                    // Prefix match with suffix: MenuRadioItem matches Menu, keep suffix RadioItem
                    const suffix = componentPart.slice(originalName.length);
                    transformedComponentPart = suffix ? `${aliasedName}${suffix}` : aliasedName;
                  }
                });
              }

              // Replace the first part (component name) with the transformed name
              // Then prepend the namespace
              parts[0] = transformedComponentPart;
              const transformedDottedName = `${namespace}.${parts.join('.')}`;

              // Set the main mapping: flatName -> transformedDottedName
              mergedTypeNameMap.set(flatName, transformedDottedName);
            });
          }
        }

        // Collect all source file paths from the re-export results for adjacent file discovery
        const sourceFilePaths = recursiveResults
          .flatMap((result) => result.sourceFilePaths || [])
          .concat([reExportInfo.sourceFile.fileName]);

        allResults.push({
          name: reExportInfo.namespaceName,
          exports: allNamespaceExports,
          typeNameMap: mergedTypeNameMap,
          sourceFilePaths,
        });
      } else {
        // Process each recursive result for regular re-exports
        for (const recursiveResult of recursiveResults) {
          // Use the reExportInfo's aliasMap if it has one, otherwise use the shared alias map
          const aliasMap = reExportInfo.aliasMap.size > 0 ? reExportInfo.aliasMap : sharedAliasMap;

          // Check if the aliasMap contains only identity mappings (e.g., Separator -> Separator)
          // If so, treat it as if there's no aliasMap - we don't want to process these exports
          const hasNonIdentityMappings =
            aliasMap && Array.from(aliasMap.entries()).some(([key, value]) => key !== value);

          if (aliasMap && aliasMap.size > 0 && hasNonIdentityMappings) {
            // Apply alias mappings to individual exports
            // Include both explicitly aliased exports AND related types that share the same prefix
            const aliasedExports: ExportNode[] = [];

            // Sort original names by length (longest first) for prefix matching
            const sortedOriginalNames = Array.from(aliasMap.keys()).sort(
              (a, b) => b.length - a.length,
            );

            for (const exportNode of recursiveResult.exports) {
              // Store the original name before any transformations for DataAttributes/CssVars lookup
              // This is especially important for re-exported components (e.g., MenuBackdrop -> ContextMenu.Backdrop)
              // where the DataAttributes file uses the original name (MenuBackdropDataAttributes)
              if (!(exportNode as any).originalName) {
                (exportNode as any).originalName = exportNode.name;
              }

              if (aliasMap.has(exportNode.name)) {
                // This export is explicitly aliased (e.g., AccordionRoot -> Root)
                const aliasedName = aliasMap.get(exportNode.name)!;

                // Skip transformation if this is an identity mapping (maps to itself)
                // but still add to aliasedExports
                if (aliasedName !== exportNode.name) {
                  exportNode.name = aliasedName;
                }
                aliasedExports.push(exportNode);
              } else {
                // Check if this export starts with any aliased component name
                // e.g., "AccordionRootState" starts with "AccordionRoot" which is aliased to "Root"
                let matched = false;
                for (const originalName of sortedOriginalNames) {
                  if (
                    exportNode.name.startsWith(originalName) &&
                    exportNode.name !== originalName
                  ) {
                    const aliasedName = aliasMap.get(originalName)!;

                    // Skip transformation if this is an identity mapping (maps to itself)
                    // but still add to aliasedExports
                    if (aliasedName !== originalName) {
                      const suffix = exportNode.name.slice(originalName.length);

                      // Rename: "AccordionRootState" -> "Root.State"
                      // Handle namespace members that already have a leading dot (e.g., ".Props")
                      if (suffix.startsWith('.')) {
                        exportNode.name = `${aliasedName}${suffix}`;
                      } else {
                        exportNode.name = `${aliasedName}.${suffix}`;
                      }
                    }

                    aliasedExports.push(exportNode);
                    matched = true;
                    break;
                  }
                }

                // If no alias match was found, still add to aliasedExports
                // This handles cases where aliasMap exists but doesn't apply to this export
                if (!matched) {
                  aliasedExports.push(exportNode);
                }
              }
            }

            // Transform typeNameMap for aliased exports
            const transformedTypeNameMap = new Map<string, string>();
            if (recursiveResult.typeNameMap) {
              recursiveResult.typeNameMap.forEach((dottedName, flatName) => {
                let transformedName = dottedName;

                // Apply alias transformations to the FIRST PART ONLY (component name)
                // E.g., MenuBackdrop.State → Backdrop.State (when MenuBackdrop -> Backdrop)
                // Do NOT add any namespace prefix here - that's handled by namespace export processing
                aliasMap.forEach((aliasedName, originalName) => {
                  const parts = dottedName.split('.');
                  const componentPart = parts[0];

                  if (componentPart === originalName || componentPart.startsWith(originalName)) {
                    const suffix = componentPart.slice(originalName.length);
                    parts[0] = suffix ? `${aliasedName}${suffix}` : aliasedName;
                    transformedName = parts.join('.');
                  }
                });

                transformedTypeNameMap.set(flatName, transformedName);
              });
            }

            // Collect source file paths from recursive result
            const sourceFilePaths = (recursiveResult.sourceFilePaths || []).concat([
              reExportInfo.sourceFile.fileName,
            ]);

            allResults.push({
              name: recursiveResult.name,
              exports: aliasedExports,
              typeNameMap: transformedTypeNameMap,
              sourceFilePaths,
            });
          } else {
            // No alias, use the original result
            allResults.push(recursiveResult);
          }
        }
      }
    }
  } else {
    // No re-exports found, parse actual exports from this file
    const { exports } = parseFromProgram(fileName, program, parserOptions);

    // Extract namespace members (e.g., Component.State, Component.Props)
    const namespaceMembers = extractNamespaceMembers(sourceFile);

    // WORKAROUND: typescript-api-extractor doesn't find `export type` declarations
    // Manually extract them from the source file AST
    const manualTypeExports: ExportNode[] = [];
    sourceFile.statements.forEach((statement) => {
      if (
        ts.isTypeAliasDeclaration(statement) &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const typeName = statement.name.text;
        // Check if this type is already in exports
        const alreadyInExports = exports.find((exp) => exp.name === typeName);
        if (!alreadyInExports) {
          // First try: Parse this type using parseFromProgram
          // This works for simple type aliases like `type Foo = string`
          const typeParserOptions: ParserOptions = {
            ...parserOptions,
            shouldInclude: ({ name }) =>
              name === typeName || parserOptions.shouldInclude?.({ name, depth: 0 }),
          };
          const { exports: typeExports } = parseFromProgram(fileName, program, typeParserOptions);
          const foundType = typeExports.find((exp) => exp.name === typeName);
          if (foundType) {
            manualTypeExports.push(foundType);
          } else {
            // Second try: For type aliases to qualified names (e.g., `type Foo = Bar.Baz`),
            // parseFromProgram doesn't work. Try to resolve the type reference manually.
            const typeNode = statement.type;

            // Check if it's a qualified name like Field.Control.ChangeEventDetails
            if (ts.isTypeReferenceNode(typeNode) && ts.isQualifiedName(typeNode.typeName)) {
              const qualifiedName = typeNode.typeName;

              // Get the symbol at this location to resolve the import
              const symbol = checker.getSymbolAtLocation(qualifiedName.left);
              if (symbol) {
                const aliasedSymbol = checker.getAliasedSymbol(symbol);
                const declarations = aliasedSymbol.declarations || symbol.declarations;

                if (declarations && declarations.length > 0) {
                  const targetSourceFile = declarations[0].getSourceFile();
                  const targetFileName = targetSourceFile.fileName;

                  // Extract the specific type from the target file
                  // For Field.Control.ChangeEventDetails, we want to find ChangeEventDetails
                  // The namespace exports it as `ChangeEventDetails`, but the actual export is `FieldControlChangeEventDetails`
                  const rightPart = qualifiedName.right.text; // e.g., "ChangeEventDetails"

                  // Build the full target name by flattening the qualified name
                  // For Field.Control.ChangeEventDetails -> FieldControlChangeEventDetails
                  const flattenQualifiedName = (node: ts.EntityName): string => {
                    if (ts.isIdentifier(node)) {
                      return node.text;
                    }
                    if (ts.isQualifiedName(node)) {
                      return flattenQualifiedName(node.left) + node.right.text;
                    }
                    return '';
                  };

                  const leftPart = flattenQualifiedName(qualifiedName.left); // "FieldControl"
                  const fullTargetName = leftPart + rightPart; // "FieldControlChangeEventDetails"

                  // Note: We DON'T pass a restrictive filter here because the target file
                  // may have the type we want, but parseFromProgram can't find it (e.g., type aliases).
                  // Instead, we let parseExports process ALL types (including manual extraction),
                  // then filter the results to find our specific type.
                  const targetTypeOptions: ParserOptions = {
                    shouldInclude: () => true, // Include all exports
                    shouldResolveObject: parserOptions.shouldResolveObject,
                  };

                  // Recursively parse the target file to extract the type
                  // This will also apply the manual type extraction workaround to the target file
                  const targetSourceFile2 = program.getSourceFile(targetFileName);
                  if (targetSourceFile2) {
                    // Temporarily remove the target file from visited set to allow re-parsing
                    // This is necessary because the file may have been visited before,
                    // but we need to extract specific type aliases that weren't included previously
                    const wasVisited = visited.has(targetFileName);
                    if (wasVisited) {
                      visited.delete(targetFileName);
                    }

                    const targetParsedResults = parseExports(
                      targetSourceFile2,
                      checker,
                      program,
                      targetTypeOptions,
                      visited,
                      undefined, // parentNamespaceName
                      true, // isWorkerContext - recursive calls inherit the context
                    );

                    // Re-add to visited set after parsing
                    if (wasVisited) {
                      visited.add(targetFileName);
                    }

                    // Flatten all exports from the results
                    const targetExports = targetParsedResults.flatMap((result) => result.exports);

                    // Try to find the target type using multiple name patterns:
                    // 1. Just the right part (e.g., "ChangeEventDetails")
                    // 2. The full flattened name (e.g., "FieldControlChangeEventDetails")
                    // 3. The dotted namespace version (e.g., "FieldControl.ChangeEventDetails")
                    const dottedTargetName = `${leftPart}.${rightPart}`;
                    const targetType =
                      targetExports.find((exp) => exp.name === rightPart) ||
                      targetExports.find((exp) => exp.name === fullTargetName) ||
                      targetExports.find((exp) => exp.name === dottedTargetName);
                    if (targetType) {
                      // Change the name property directly (ExportNode is mutable)
                      // This renames FieldControlChangeEventDetails to InputChangeEventDetails
                      targetType.name = typeName;
                      manualTypeExports.push(targetType);
                    }
                  }
                }
              }
            } else {
              // Type alias is not a qualified name (e.g., literal type or simple generic)
              // Extract it as a serializable structure that can be processed during HAST formatting
              const fallbackExport = extractTypeAliasAsExportNode(
                typeName,
                statement,
                sourceFile,
                checker,
              );
              if (fallbackExport) {
                manualTypeExports.push(fallbackExport);
              }
            }
          }
        }
      }
    });

    // Merge manual exports with parsed exports
    const allExports = [...exports, ...manualTypeExports];

    // Build typeNameMap from namespace members
    // For each namespace (e.g., "MenuRadioItem"), add entries for its members
    // E.g., "MenuRadioItemState" -> "Menu.RadioItem.State" (will be transformed later with namespace prefix)
    const typeNameMap = new Map<string, string>();

    // Also build a reverse map: memberName -> componentName for namespace member detection
    const memberToComponentMap = new Map<string, string>();

    Array.from(namespaceMembers.entries()).forEach(([componentName, members]) => {
      Array.from(members.entries()).forEach(([memberName, flatTypeName]) => {
        // The flat name is like "MenuRadioItemState"
        // For now just map it to "ComponentName.MemberName", namespace prefix added later
        typeNameMap.set(flatTypeName, `${componentName}.${memberName}`);

        // Track which member names belong to which component
        memberToComponentMap.set(memberName, componentName);
      });

      // ALSO add the component name itself to the map (e.g., MenuRadioItem → Menu.RadioItem)
      // This is needed for references like "MenuRadioItem.State" where MenuRadioItem needs transformation
      // The namespace prefix will be added later during re-export processing
      if (members.size > 0) {
        typeNameMap.set(componentName, componentName);
      }
    });

    // Apply typeNameMap transformations to flat exports
    // This converts exports like "ToggleState" -> "Toggle.State"
    const transformedExports = allExports.map((exp) => {
      const dottedName = typeNameMap.get(exp.name);
      if (dottedName) {
        // This export is a namespace member, replace with dotted name
        const transformedExport = Object.assign(Object.create(Object.getPrototypeOf(exp)), exp, {
          name: dottedName,
        });
        return transformedExport;
      }
      return exp;
    });

    // Process exports to detect namespace members (indicated by leading dot)
    // and store this information as metadata
    const processedExports = transformedExports.map((exp) => {
      if (exp.name.startsWith('.')) {
        // This is a namespace member - store the flag and prefix with component name
        const memberName = exp.name.slice(1); // Remove leading dot
        const componentName = memberToComponentMap.get(memberName);

        // Build the full name: Component.Member (e.g., "Toggle.Props")
        const fullName = componentName ? `${componentName}.${memberName}` : memberName;

        const processedExport: ExportNode & { isNamespaceMember: boolean } = Object.assign(
          Object.create(Object.getPrototypeOf(exp)),
          exp,
          { name: fullName, isNamespaceMember: true },
        );
        return processedExport;
      }
      return exp;
    });

    allResults.push({
      name: '',
      exports: processedExports,
      typeNameMap,
      sourceFilePaths: [sourceFile.fileName],
    });
  }

  return allResults;
}
