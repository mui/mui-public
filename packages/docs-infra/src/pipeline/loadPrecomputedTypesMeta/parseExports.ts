import * as ts from 'typescript';
import type { Program, SourceFile, TypeChecker } from 'typescript';
import * as fs from 'node:fs';
import { parseFromProgram, type ExportNode, type ParserOptions } from 'typescript-api-extractor';

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
    console.warn(
      '[expandIntersectionType] Found intersection type with',
      type.types.length,
      'parts',
    );

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
      console.warn(`  [${i}]:`, typeStr.substring(0, 150));

      expandedTypes.push(typeStr);

      // Check if this part is a discriminated union (contains multiple "{ reason:" variants)
      if (typeStr.includes('{ reason:') && typeStr.includes(' | ')) {
        hasDiscriminatedUnion = true;
        unionTypeStr = typeStr;
      }
    }

    console.warn('[expandIntersectionType] Has discriminated union:', hasDiscriminatedUnion);

    if (hasDiscriminatedUnion && unionTypeStr && expandedTypes.length === 2) {
      // Find the other type (the one that's not the union)
      const additionalPropsType = expandedTypes.find((t) => t !== unionTypeStr);

      if (additionalPropsType && additionalPropsType.trim().startsWith('{')) {
        console.warn('[expandIntersectionType] Merging discriminated union with additional props');

        // Extract just the additional properties from the object (remove outer braces)
        const additionalPropsInner = additionalPropsType
          .trim()
          .replace(/^\{/, '')
          .replace(/\}$/, '')
          .trim();

        // Split the union into individual variants
        const variants = unionTypeStr.split(' | ').map((v) => v.trim());

        console.warn(
          '[expandIntersectionType] Merging',
          variants.length,
          'variants with props:',
          additionalPropsInner.substring(0, 50),
        );

        // Add the additional props to each variant
        const mergedVariants = variants.map((variant) => {
          // Remove trailing } and add the additional props
          const withoutClosing = variant.replace(/\s*\}\s*$/, '');
          return `${withoutClosing}; ${additionalPropsInner}; }`;
        });

        const result = mergedVariants.join(' | ');
        console.warn('[expandIntersectionType] Merged successfully');
        return result;
      }
    }

    // If we can't merge, just return the intersection as-is
    console.warn('[expandIntersectionType] Could not merge, returning as intersection');
    return checker.typeToString(type, statement, flags);
  }

  // Check if this is a union type (which we also want to expand fully)
  if (type.isUnion()) {
    // Let TypeScript handle the union expansion
    return checker.typeToString(type, statement, flags);
  }

  // Not an intersection or union, just convert to string
  return checker.typeToString(type, statement, flags);
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
      expandedTypeText = checker.typeToString(type, statement, flags);

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

          const furtherExpanded = checker.typeToString(currentType, statement, flags);

          // Check if it's an object type that we can expand manually
          // Only do this for actual object types (not primitives like string, number, unions, etc.)
          // Also skip React built-in types which are better left as-is
          // eslint-disable-next-line no-bitwise
          const isObjectType = !!(currentType.flags & ts.TypeFlags.Object);
          // eslint-disable-next-line no-bitwise
          const isNotUnion = !(currentType.flags & ts.TypeFlags.Union);
          // eslint-disable-next-line no-bitwise
          const isNotPrimitive = !(
            currentType.flags &
            (ts.TypeFlags.String |
              ts.TypeFlags.Number |
              ts.TypeFlags.Boolean |
              ts.TypeFlags.StringLiteral |
              ts.TypeFlags.NumberLiteral |
              ts.TypeFlags.BooleanLiteral)
          );
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
                const propTypeString = checker.typeToString(
                  propType,
                  statement,
                  ts.TypeFormatFlags.None,
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
          const unionParts = type.types.map((t) => checker.typeToString(t, statement, flags));
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
          const partStr = checker.typeToString(partType, statement, flags);
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

  // DEBUG: Log file being processed
  if (
    sourceFile.fileName.includes('context-menu/index.parts') ||
    sourceFile.fileName.includes('menu/index.ts') ||
    sourceFile.fileName.includes('menu/index.parts')
  ) {
    console.warn('[parseExports] ===== Processing file:', sourceFile.fileName);
    console.warn('[parseExports] Found', exportedSymbols?.length || 0, 'export symbols');
  }

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
      // DEBUG: Log for Toolbar and ContextMenu
      if (
        sourceFile.fileName.includes('toolbar/index') ||
        sourceFile.fileName.includes('context-menu/index')
      ) {
        console.warn('[parseExports] Found NamespaceExport for symbol:', symbol.name);
      }

      const exportDecl = namespaceExportDecl.parent;

      if (ts.isExportDeclaration(exportDecl) && exportDecl.moduleSpecifier) {
        const moduleSpecifier = exportDecl.moduleSpecifier;

        if (ts.isStringLiteral(moduleSpecifier)) {
          // Get the source file of the module being re-exported
          const importedSymbol = checker.getSymbolAtLocation(moduleSpecifier);
          const importedSourceFile = importedSymbol?.valueDeclaration?.getSourceFile();

          if (importedSourceFile) {
            const namespaceName = symbol.name;

            // DEBUG: Log for Toolbar
            if (sourceFile.fileName.includes('toolbar/index.ts')) {
              console.warn('[parseExports] Creating namespace reExport with name:', namespaceName);
              console.warn('[parseExports] Source file:', importedSourceFile.fileName);
            }

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

            // DEBUG: Log for ContextMenu index.parts.ts and Menu
            if (
              sourceFile.fileName.includes('context-menu/index.parts') ||
              sourceFile.fileName.includes('menu/index.parts')
            ) {
              console.warn('[parseExports] ExportSpecifier:', {
                originalName,
                exportedName,
                sourceFile: importedSourceFile.fileName,
              });
              console.warn('[parseExports] parentNamespaceName:', parentNamespaceName);
            }

            // Find or create the reExportInfo for this source file
            let reExportInfo = reExportInfos.find((info) => info.sourceFile === importedSourceFile);
            if (!reExportInfo) {
              reExportInfo = {
                sourceFile: importedSourceFile,
                aliasMap: new Map(),
                // Do NOT inherit parent namespace - it will be added later during namespace processing
              };
              reExportInfos.push(reExportInfo);

              // DEBUG: Log for ContextMenu and Menu
              if (
                sourceFile.fileName.includes('context-menu/index.parts') ||
                sourceFile.fileName.includes('menu/index.parts')
              ) {
                console.warn(
                  '[parseExports] Created new reExportInfo for',
                  importedSourceFile.fileName,
                );
              }
            }

            // Store the alias mapping
            reExportInfo.aliasMap.set(originalName, exportedName);

            // DEBUG: Log for ContextMenu and Menu
            if (
              sourceFile.fileName.includes('context-menu/index.parts') ||
              sourceFile.fileName.includes('menu/index.parts')
            ) {
              console.warn('[parseExports] Set alias mapping:', originalName, '→', exportedName);
              console.warn('[parseExports] aliasMap size now:', reExportInfo.aliasMap.size);
              console.warn('[parseExports] importedSourceFile:', importedSourceFile.fileName);
            }
          }
        }
      } else {
        // When we have an ExportSpecifier without a moduleSpecifier, it could be from:
        // 1. A transformed namespace export (export * as X) compiled to JS
        // 2. A regular export from the same file
        // We need to trace the symbol to find its actual source

        // DEBUG: Log for Toolbar
        if (sourceFile.fileName.includes('toolbar/index.ts')) {
          console.warn('[parseExports] ExportSpecifier without moduleSpecifier:', symbol.name);
          console.warn('[parseExports] Checking for aliased symbol...');
        }

        // Try to find the actual source by looking at the aliased symbol
        const aliasedSymbol = checker.getAliasedSymbol(symbol);

        // DEBUG: Log aliased symbol for Toolbar
        if (sourceFile.fileName.includes('toolbar/index.ts')) {
          console.warn('[parseExports] aliasedSymbol:', aliasedSymbol?.name);
          console.warn('[parseExports] aliasedSymbol === symbol:', aliasedSymbol === symbol);
        }

        if (aliasedSymbol && aliasedSymbol !== symbol) {
          const aliasedDeclarations = aliasedSymbol.declarations;

          // DEBUG: Log declarations for Toolbar
          if (sourceFile.fileName.includes('toolbar/index.ts')) {
            console.warn('[parseExports] aliasedDeclarations:', aliasedDeclarations?.length);
          }

          if (aliasedDeclarations && aliasedDeclarations.length > 0) {
            const aliasedSourceFile = aliasedDeclarations[0].getSourceFile();

            // DEBUG: Log source file for Toolbar
            if (sourceFile.fileName.includes('toolbar/index.ts')) {
              console.warn(
                '[parseExports] Found namespace export! aliasedSourceFile:',
                aliasedSourceFile.fileName,
              );
              console.warn('[parseExports] Setting namespaceName:', symbol.name);
            }

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
    // DEBUG: Log all reExportInfos for Toolbar, ContextMenu, and Menu
    if (
      sourceFile.fileName.includes('toolbar/index') ||
      sourceFile.fileName.includes('context-menu/index') ||
      sourceFile.fileName.includes('menu/index')
    ) {
      console.warn(
        `[parseExports] ${sourceFile.fileName} has ${reExportInfos.length} reExportInfos:`,
      );
      reExportInfos.forEach((info, idx) => {
        console.warn(
          `  [${idx}] sourceFile: ${info.sourceFile.fileName}, namespaceName: ${info.namespaceName}, aliasMap: ${info.aliasMap.size}`,
        );
      });
    }

    // Check if any re-export has a namespace - if so, collect its aliases to share with type exports
    const namespaceReExport = reExportInfos.find((info) => info.namespaceName);
    let sharedAliasMap: Map<string, string> | undefined;
    let filteredReExportInfos = reExportInfos;

    // If we have a namespace export, ONLY process that one and skip type-only re-exports
    // This prevents duplicate processing when we have both `export * as Name` and `export type *`
    if (namespaceReExport) {
      // DEBUG: Log all reExportInfos for toolbar
      if (sourceFile.fileName.includes('toolbar/index.ts')) {
        const logPath = '/tmp/toolbar-typegen-debug.log';
        const logMessage = `[parseExports] Total reExportInfos for index.ts: ${reExportInfos.length}\n`;
        reExportInfos.forEach((info, idx) => {
          fs.appendFileSync(
            logPath,
            `[${idx}] sourceFile: ${info.sourceFile.fileName}, namespaceName: ${info.namespaceName}, aliasMap: ${info.aliasMap.size}\n`,
          );
        });
        fs.appendFileSync(logPath, logMessage);
      }

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

      // DEBUG: Log filtering for ContextMenu
      if (sourceFile.fileName.includes('context-menu/index')) {
        console.warn(
          `[parseExports] Filtered reExportInfos from ${reExportInfos.length} to ${filteredReExportInfos.length} (keeping only namespace export)`,
        );
      }
    }

    for (const reExportInfo of filteredReExportInfos) {
      // DEBUG: Log when parsing from Menu index.parts
      if (sourceFile.fileName.includes('menu/index.parts')) {
        console.warn('[parseExports] Calling parseExports for reExportInfo from menu/index.parts:', reExportInfo.sourceFile.fileName);
      }
      
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

      // DEBUG: Log recursiveResults count for Menu
      if (sourceFile.fileName.includes('menu/index.parts')) {
        console.warn('[parseExports] Recursive call returned', recursiveResults.length, 'results for:', reExportInfo.sourceFile.fileName);
        if (recursiveResults.length === 0) {
          console.warn('[parseExports] WARNING: No results returned for:', reExportInfo.sourceFile.fileName);
        }
      }

      // DEBUG: Log which path we're taking
      if (sourceFile.fileName.includes('toolbar')) {
        console.warn('[parseExports] Re-export path for', sourceFile.fileName);
        console.warn('[parseExports] Has namespaceName:', reExportInfo.namespaceName);
        console.warn('[parseExports] Has aliasMap:', reExportInfo.aliasMap.size);
      }

      if (reExportInfo.namespaceName) {
        // For namespace exports, collect all exports from all recursive results
        // and prefix them with the namespace name
        // e.g., ButtonRootProps becomes Button.Root.Props in the Button namespace
        const allNamespaceExports: ExportNode[] = [];

        // Use the reExportInfo's aliasMap if it has one, otherwise use the shared alias map
        const aliasMap = reExportInfo.aliasMap.size > 0 ? reExportInfo.aliasMap : sharedAliasMap;

        // DEBUG: Log recursiveResults for ContextMenu and Menu
        if (reExportInfo.namespaceName === 'ContextMenu' || reExportInfo.namespaceName === 'Menu') {
          console.warn('[parseExports-namespace] Processing namespace:', reExportInfo.namespaceName);
          console.warn('[parseExports-namespace] recursiveResults count:', recursiveResults.length);
          recursiveResults.forEach((result, idx) => {
            console.warn(`[parseExports-namespace] recursiveResults[${idx}]:`, {
              name: result.name,
              exportsCount: result.exports.length,
              typeNameMapSize: result.typeNameMap?.size || 0,
            });
            if (result.name && result.name.includes('Root')) {
              console.warn(`[parseExports-namespace]   ** Contains Root! exports:`, result.exports.map((exportNode) => exportNode.name).slice(0, 10));
            }
            if (result.typeNameMap && result.typeNameMap.size > 0) {
              const entries = Array.from(result.typeNameMap.entries()).slice(0, 3);
              entries.forEach(([flatName, dottedName]) => {
                console.warn(
                  `[parseExports-namespace]   typeNameMap entry: ${flatName} → ${dottedName}`,
                );
              });
            }
          });
        }

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
            if (aliasMap && aliasMap.size > 0) {
              aliasMap.forEach((aliasedName, originalName) => {
                if (transformedName === exportName && exportNode.name.startsWith(originalName)) {
                  // DEBUG: Log MenuRoot transformation
                  if (originalName === 'MenuRoot' || exportName.includes('MenuRoot')) {
                    console.warn('[parseExports] MenuRoot alias transformation:', {
                      originalName,
                      aliasedName,
                      exportName,
                      'exportNode.name': exportNode.name,
                      namespaceName,
                    });
                  }

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

                  // DEBUG: Log MenuRoot result
                  if (originalName === 'MenuRoot' || exportName.includes('MenuRoot')) {
                    console.warn('[parseExports] MenuRoot transformed to:', transformedName);
                  }
                }
              });
            }

            // If no alias match found, add namespace prefix
            // The originalName (stored above) preserves the name before any aliasing,
            // so we can use it directly for lookups later
            if (transformedName === exportName) {
              // DEBUG: Check for double dots BEFORE transformation
              if (exportName.includes('Separator') && exportName.includes('..')) {
                console.warn('[parseExports] DOUBLE DOT BEFORE TRANSFORM:', {
                  exportName,
                  namespaceName,
                  'exportNode.name': exportNode.name,
                });
              }

              if (exportName.startsWith(namespaceName)) {
                // Export already starts with namespace (e.g., "AutocompleteRootProps")
                // Remove namespace prefix and re-add with dots
                const withoutNamespace = exportName.slice(namespaceName.length);
                if (withoutNamespace) {
                  transformedName = `${namespaceName}.${withoutNamespace}`;
                }
              } else if (exportName.includes('.')) {
                // Export is already dotted (e.g., "Separator.Props" from namespace member)
                // Just prepend the namespace

                // DEBUG: Check what's being concatenated
                if (exportName.includes('Separator')) {
                  console.warn('[parseExports] Adding namespace prefix to dotted export:', {
                    exportName,
                    namespaceName,
                    result: `${namespaceName}.${exportName}`,
                  });
                }

                transformedName = `${namespaceName}.${exportName}`;
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

        // DEBUG: Log namespace for Toolbar and ContextMenu
        if (namespace === 'Toolbar' || namespace === 'ContextMenu') {
          const logPath =
            namespace === 'Toolbar'
              ? '/tmp/toolbar-typegen-debug.log'
              : '/tmp/contextmenu-typegen-debug.log';
          const logMessage =
            `[parseExports] Processing namespace: ${namespace}\n` +
            `[parseExports] recursiveResults count: ${recursiveResults.length}\n`;
          fs.appendFileSync(logPath, logMessage);
          console.warn('[parseExports] Processing namespace:', namespace);
          console.warn('[parseExports] recursiveResults count:', recursiveResults.length);
          recursiveResults.forEach((result, idx) => {
            const hasMap = result.typeNameMap ? 'has typeNameMap' : 'NO typeNameMap';
            const mapSize = result.typeNameMap?.size || 0;
            const msg = `[parseExports] recursiveResults[${idx}]: ${hasMap}, size=${mapSize}, name=${result.name}\n`;
            fs.appendFileSync(logPath, msg);
            console.warn(msg.trim());

            // For ContextMenu, also log the actual typeNameMap entries
            if (namespace === 'ContextMenu' && result.typeNameMap) {
              Array.from(result.typeNameMap.entries()).forEach(([key, value]) => {
                const entryMsg = `[parseExports]   typeNameMap entry: ${key} → ${value}\n`;
                fs.appendFileSync(logPath, entryMsg);
                console.warn(entryMsg.trim());
              });
            }
          });
        }

        for (const result of recursiveResults) {
          if (result.typeNameMap) {
            Array.from(result.typeNameMap.entries()).forEach(([flatName, dottedName]) => {
              // DEBUG: Log transformation for ContextMenuRoot
              if (namespace === 'ContextMenu' && flatName.includes('ContextMenuRoot')) {
                console.warn('[parseExports-namespace] Processing ContextMenuRoot entry:', {
                  flatName,
                  dottedName,
                  namespace,
                });
              }

              // DEBUG: Log transformation for Toolbar or ContextMenu
              if (
                (namespace === 'Toolbar' &&
                  (flatName.includes('Orientation') || flatName.includes('ToolbarRoot'))) ||
                (namespace === 'ContextMenu' &&
                  (flatName.includes('MenuRoot') || flatName.includes('MenuBackdrop')))
              ) {
                const logPath =
                  namespace === 'Toolbar'
                    ? '/tmp/toolbar-typegen-debug.log'
                    : '/tmp/contextmenu-typegen-debug.log';
                const logMessage = `[parseExports] Before transformation: ${JSON.stringify({ flatName, dottedName, namespace })}\n`;
                fs.appendFileSync(logPath, logMessage);
                console.warn('[parseExports] Before transformation:', {
                  flatName,
                  dottedName,
                  namespace,
                });
              }

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

              // DEBUG: Log transformation for Toolbar or ContextMenu
              if (
                (namespace === 'Toolbar' &&
                  (flatName.includes('Orientation') || flatName.includes('ToolbarRoot'))) ||
                (namespace === 'ContextMenu' &&
                  (flatName.includes('MenuRoot') || flatName.includes('MenuBackdrop')))
              ) {
                const logPath =
                  namespace === 'Toolbar'
                    ? '/tmp/toolbar-typegen-debug.log'
                    : '/tmp/contextmenu-typegen-debug.log';
                const logMessage = `[parseExports] After transformation: ${JSON.stringify({ flatName, transformedDottedName, componentPart, transformedComponentPart })}\n`;
                fs.appendFileSync(logPath, logMessage);
                console.warn('[parseExports] After transformation:', {
                  flatName,
                  transformedDottedName,
                  componentPart,
                  transformedComponentPart,
                });
              }

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
          // DEBUG: Log when processing MenuRoot.tsx results
          if (reExportInfo.sourceFile.fileName.includes('MenuRoot.tsx')) {
            console.warn('[parseExports] Processing recursiveResult for reExportInfo.sourceFile:', reExportInfo.sourceFile.fileName);
            console.warn('[parseExports] recursiveResult.exports.length:', recursiveResult.exports.length);
            console.warn('[parseExports] recursiveResult.exports names:', recursiveResult.exports.map((exportNode) => exportNode.name));
          }
          
          // Use the reExportInfo's aliasMap if it has one, otherwise use the shared alias map
          const aliasMap = reExportInfo.aliasMap.size > 0 ? reExportInfo.aliasMap : sharedAliasMap;

          if (aliasMap && aliasMap.size > 0) {
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

              // DEBUG: Log MenuRoot specifically
              if (exportNode.name === 'MenuRoot') {
                console.warn('[parseExports] Found MenuRoot export, checking aliasMap...');
                console.warn('[parseExports] aliasMap.has(MenuRoot):', aliasMap.has('MenuRoot'));
                console.warn('[parseExports] aliasMap.get(MenuRoot):', aliasMap.get('MenuRoot'));
                console.warn('[parseExports] aliasMap size:', aliasMap.size);
                console.warn('[parseExports] aliasMap keys:', Array.from(aliasMap.keys()));
              }

              if (aliasMap.has(exportNode.name)) {
                // This export is explicitly aliased (e.g., AccordionRoot -> Root)
                const aliasedName = aliasMap.get(exportNode.name)!;
                
                // DEBUG: Log when we transform MenuRoot
                if (exportNode.name === 'MenuRoot') {
                  console.warn('[parseExports] Transforming MenuRoot to:', aliasedName);
                }
                
                exportNode.name = aliasedName;
                aliasedExports.push(exportNode);
              } else {
                // Check if this export starts with any aliased component name
                // e.g., "AccordionRootState" starts with "AccordionRoot" which is aliased to "Root"
                for (const originalName of sortedOriginalNames) {
                  if (
                    exportNode.name.startsWith(originalName) &&
                    exportNode.name !== originalName
                  ) {
                    const aliasedName = aliasMap.get(originalName)!;
                    const suffix = exportNode.name.slice(originalName.length);

                    // Rename: "AccordionRootState" -> "Root.State"
                    // Handle namespace members that already have a leading dot (e.g., ".Props")
                    if (suffix.startsWith('.')) {
                      exportNode.name = `${aliasedName}${suffix}`;
                    } else {
                      exportNode.name = `${aliasedName}.${suffix}`;
                    }

                    aliasedExports.push(exportNode);
                    break;
                  }
                }
              }
            }

            // Transform typeNameMap for aliased exports
            const transformedTypeNameMap = new Map<string, string>();
            if (recursiveResult.typeNameMap) {
              // DEBUG: Log typeNameMap transformation for Toolbar
              if (reExportInfo.sourceFile.fileName.includes('toolbar')) {
                const logPath = '/tmp/toolbar-typegen-debug.log';
                const logMessage =
                  `[parseExports-regular] Processing aliased re-export for ${reExportInfo.sourceFile.fileName}\n` +
                  `[parseExports-regular] recursiveResult.typeNameMap size: ${recursiveResult.typeNameMap.size}\n` +
                  `[parseExports-regular] aliasMap size: ${aliasMap.size}\n` +
                  `[parseExports-regular] aliasMap entries: ${JSON.stringify(Array.from(aliasMap.entries()))}\n`;
                fs.appendFileSync(logPath, logMessage);
              }

              recursiveResult.typeNameMap.forEach((dottedName, flatName) => {
                let transformedName = dottedName;

                // DEBUG: Log transformation for Toolbar types OR MenuBackdrop
                if (
                  (reExportInfo.sourceFile.fileName.includes('toolbar') &&
                    (flatName.includes('Orientation') || flatName.includes('ToolbarRoot'))) ||
                  flatName.includes('MenuBackdrop')
                ) {
                  const logPath = reExportInfo.sourceFile.fileName.includes('toolbar')
                    ? '/tmp/toolbar-typegen-debug.log'
                    : '/tmp/contextmenu-typegen-debug.log';
                  const logMessage = `[parseExports-regular] Transforming: ${flatName} → ${dottedName} (from ${reExportInfo.sourceFile.fileName})\n`;
                  fs.appendFileSync(logPath, logMessage);
                  console.warn(
                    `[parseExports-regular] Transforming: ${flatName} → ${dottedName} (from ${reExportInfo.sourceFile.fileName})`,
                  );
                }

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

                // DEBUG: Log final transformation for Toolbar types OR MenuBackdrop OR ContextMenuRoot
                if (
                  (reExportInfo.sourceFile.fileName.includes('toolbar') &&
                    (flatName.includes('Orientation') || flatName.includes('ToolbarRoot'))) ||
                  flatName.includes('MenuBackdrop') ||
                  flatName.includes('ContextMenuRoot')
                ) {
                  const logPath = reExportInfo.sourceFile.fileName.includes('toolbar')
                    ? '/tmp/toolbar-typegen-debug.log'
                    : '/tmp/contextmenu-typegen-debug.log';
                  const logMessage = `[parseExports-regular] Final transformed: ${flatName} → ${transformedName}\n`;
                  fs.appendFileSync(logPath, logMessage);
                  console.warn(
                    `[parseExports-regular] Final transformed: ${flatName} → ${transformedName}`,
                  );
                }

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

            // DEBUG: Log when adding results from ContextMenuRoot
            if (reExportInfo.sourceFile.fileName.includes('ContextMenuRoot')) {
              console.warn(
                '[parseExports-regular] Added result for ContextMenuRoot, typeNameMap size:',
                transformedTypeNameMap.size,
              );
              const entries = Array.from(transformedTypeNameMap.entries());
              entries.forEach(([flatName, dottedName]) => {
                console.warn(`[parseExports-regular]   ${flatName} → ${dottedName}`);
              });
            }
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

    // DEBUG: Log exports for Menu index.parts.ts
    if (fileName.includes('/menu/index.parts.ts')) {
      console.warn('[parseExports] Menu index.parts.ts - START');
      console.warn('[parseExports] Menu index.parts.ts exports:', exports.map((exp) => exp.name));
      console.warn('[parseExports] Menu index.parts.ts - Processing re-exports...');
    }

    // DEBUG: Log exports for MenuRoot.tsx
    if (fileName.includes('/menu/root/MenuRoot.tsx')) {
      console.warn('[parseExports] MenuRoot.tsx exports from typescript-api-extractor:', exports.map((exp) => exp.name));
      console.warn('[parseExports] MenuRoot.tsx exports count:', exports.length);
      // Check MenuRoot specifically
      const menuRootExport = exports.find((exp) => exp.name === 'MenuRoot');
      if (menuRootExport) {
        console.warn('[parseExports] MenuRoot export found:');
        console.warn('  type.kind:', (menuRootExport.type as any).kind);
        console.warn('  is component:', (menuRootExport.type as any).kind === 'component');
      }
    }

    // Extract namespace members (e.g., Component.State, Component.Props)
    const namespaceMembers = extractNamespaceMembers(sourceFile);

    // WORKAROUND: typescript-api-extractor doesn't find `export type` declarations
    // Manually extract them from the source file AST
    const manualTypeExports: ExportNode[] = [];
    fs.appendFileSync('/tmp/all-files-parsed.log', `Parsing: ${fileName}\n`);
    if (fileName.includes('Input.tsx')) {
      fs.appendFileSync('/tmp/all-files-parsed.log', `  SourceFile path: ${sourceFile.fileName}\n`);
      fs.appendFileSync(
        '/tmp/all-files-parsed.log',
        `  Total statements: ${sourceFile.statements.length}\n`,
      );
    }
    if (fileName.includes('FieldControl.tsx')) {
      fs.appendFileSync(
        '/tmp/all-files-parsed.log',
        `[FieldControl] Initial exports from parseFromProgram: ${exports.length}, names: ${exports.map((exp) => exp.name).join(', ')}\n`,
      );
    }
    sourceFile.statements.forEach((statement, idx) => {
      if (ts.isTypeAliasDeclaration(statement)) {
        const hasExport = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        const typeName = statement.name.text;
        if (typeName.includes('InputChange') || typeName.includes('FieldControl')) {
          fs.appendFileSync(
            '/tmp/all-files-parsed.log',
            `  [${fileName}] Statement ${idx}: Type alias ${typeName}, exported: ${hasExport}\n`,
          );
        }
      }
      if (
        ts.isTypeAliasDeclaration(statement) &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const typeName = statement.name.text;
        if (fileName.includes('FieldControl.tsx')) {
          fs.appendFileSync(
            '/tmp/all-files-parsed.log',
            `  [FieldControl] Found exported type alias: ${typeName}\n`,
          );
        }
        fs.appendFileSync('/tmp/all-files-parsed.log', `  Found type alias: ${typeName}\n`);
        // Check if this type is already in exports
        const alreadyInExports = exports.find((exp) => exp.name === typeName);
        if (typeName.includes('InputChange') || fileName.includes('FieldControl.tsx')) {
          fs.appendFileSync(
            '/tmp/all-files-parsed.log',
            `    [${fileName}] ${typeName} already in exports: ${!!alreadyInExports}\n`,
          );
        }
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
          if (typeName.includes('InputChange') || fileName.includes('FieldControl.tsx')) {
            fs.appendFileSync(
              '/tmp/all-files-parsed.log',
              `    parseFromProgram for ${typeName}: found ${typeExports.length} exports: ${typeExports.map((exp) => exp.name).join(', ')}\n`,
            );
            fs.appendFileSync(
              '/tmp/all-files-parsed.log',
              `    parseFromProgram found ${typeName}: ${!!foundType}\n`,
            );
          }
          if (foundType) {
            manualTypeExports.push(foundType);
            if (fileName.includes('FieldControl.tsx')) {
              fs.appendFileSync(
                '/tmp/all-files-parsed.log',
                `    [FieldControl] Added ${typeName} to manualTypeExports via parseFromProgram\n`,
              );
            }
          } else {
            // Second try: For type aliases to qualified names (e.g., `type Foo = Bar.Baz`),
            // parseFromProgram doesn't work. Try to resolve the type reference manually.
            const typeNode = statement.type;

            if (fileName.includes('Input.tsx')) {
              const logPath = '/tmp/input-type-debug.log';
              const log = [
                `Type alias: ${typeName}`,
                `Type node kind: ${typeNode.kind}`,
                `SyntaxKind.TypeReference: ${ts.SyntaxKind.TypeReference}`,
                `Is TypeReference: ${ts.isTypeReferenceNode(typeNode)}`,
              ];
              if (ts.isTypeReferenceNode(typeNode)) {
                log.push(`TypeName: ${typeNode.typeName.getText(sourceFile)}`);
                log.push(`TypeName kind: ${typeNode.typeName.kind}`);
                log.push(`SyntaxKind.QualifiedName: ${ts.SyntaxKind.QualifiedName}`);
                log.push(`Is QualifiedName: ${ts.isQualifiedName(typeNode.typeName)}`);
              }
              fs.appendFileSync(logPath, `${log.join('\n')}\n\n`);
            }

            // Check if it's a qualified name like Field.Control.ChangeEventDetails
            if (ts.isTypeReferenceNode(typeNode) && ts.isQualifiedName(typeNode.typeName)) {
              const qualifiedName = typeNode.typeName;

              fs.appendFileSync(
                '/tmp/all-files-parsed.log',
                `    [QN] Resolving qualified name for ${typeName}\n`,
              );

              // Get the symbol at this location to resolve the import
              const symbol = checker.getSymbolAtLocation(qualifiedName.left);
              fs.appendFileSync(
                '/tmp/all-files-parsed.log',
                `    [QN] Symbol found for ${typeName}: ${!!symbol}\n`,
              );
              if (symbol) {
                const aliasedSymbol = checker.getAliasedSymbol(symbol);
                const declarations = aliasedSymbol.declarations || symbol.declarations;

                fs.appendFileSync(
                  '/tmp/all-files-parsed.log',
                  `    [QN] Declarations for ${typeName}: ${!!declarations}, count: ${declarations?.length}\n`,
                );

                if (declarations && declarations.length > 0) {
                  const targetSourceFile = declarations[0].getSourceFile();
                  const targetFileName = targetSourceFile.fileName;

                  fs.appendFileSync(
                    '/tmp/all-files-parsed.log',
                    `    [QN] Target file for ${typeName}: ${targetFileName}\n`,
                  );

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

                  if (typeName.includes('InputChange')) {
                    fs.appendFileSync(
                      '/tmp/all-files-parsed.log',
                      `    [QN] Looking for: ${rightPart} or ${fullTargetName}\n`,
                    );
                  }

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
                      fs.appendFileSync(
                        '/tmp/all-files-parsed.log',
                        `    [QN] Removed ${targetFileName} from visited to allow re-parsing for ${typeName}\n`,
                      );
                    } else {
                      fs.appendFileSync(
                        '/tmp/all-files-parsed.log',
                        `    [QN] ${targetFileName} NOT in visited, will parse normally for ${typeName}\n`,
                      );
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

                    fs.appendFileSync(
                      '/tmp/all-files-parsed.log',
                      `    [QN] Target exports for ${typeName}: ${targetExports.length}, names: ${targetExports.map((exp) => exp.name).join(', ')}\n`,
                    );

                    // Try to find the target type using multiple name patterns:
                    // 1. Just the right part (e.g., "ChangeEventDetails")
                    // 2. The full flattened name (e.g., "FieldControlChangeEventDetails")
                    // 3. The dotted namespace version (e.g., "FieldControl.ChangeEventDetails")
                    const dottedTargetName = `${leftPart}.${rightPart}`;
                    const targetType =
                      targetExports.find((exp) => exp.name === rightPart) ||
                      targetExports.find((exp) => exp.name === fullTargetName) ||
                      targetExports.find((exp) => exp.name === dottedTargetName);
                    fs.appendFileSync(
                      '/tmp/all-files-parsed.log',
                      `    [QN] Found target type for ${typeName}: ${!!targetType}, looking for: ${rightPart}, ${fullTargetName}, or ${dottedTargetName}\n`,
                    );
                    if (targetType) {
                      // Change the name property directly (ExportNode is mutable)
                      // This renames FieldControlChangeEventDetails to InputChangeEventDetails
                      targetType.name = typeName;
                      manualTypeExports.push(targetType);
                      fs.appendFileSync(
                        '/tmp/all-files-parsed.log',
                        `    [QN] Added ${typeName} to manualTypeExports\n`,
                      );
                    }
                  }
                }
              }
            } else {
              // Type alias is not a qualified name (e.g., literal type or simple generic)
              // Extract it as a serializable structure that can be processed during HAST formatting
              if (fileName.includes('FieldControl.tsx') || typeName.includes('InputChange')) {
                fs.appendFileSync(
                  '/tmp/all-files-parsed.log',
                  `    [Fallback] ${typeName} is not a qualified name, will extract as serializable structure\n`,
                );
              }

              const fallbackExport = extractTypeAliasAsExportNode(
                typeName,
                statement,
                sourceFile,
                checker,
              );
              if (fallbackExport) {
                manualTypeExports.push(fallbackExport);
                if (fileName.includes('FieldControl.tsx')) {
                  fs.appendFileSync(
                    '/tmp/all-files-parsed.log',
                    `    [Fallback] Added ${typeName} to manualTypeExports as serializable structure\n`,
                  );
                }
              } else if (fileName.includes('FieldControl.tsx')) {
                fs.appendFileSync(
                  '/tmp/all-files-parsed.log',
                  `    [Fallback] Could not extract ${typeName} as serializable structure\n`,
                );
              }
            }
          }
        }
      }
    });

    // Merge manual exports with parsed exports
    const allExports = [...exports, ...manualTypeExports];

    if (fileName.includes('FieldControl.tsx')) {
      fs.appendFileSync(
        '/tmp/all-files-parsed.log',
        `[FieldControl] Total exports: ${exports.length}, manual: ${manualTypeExports.length}, all: ${allExports.length}\n`,
      );
      fs.appendFileSync(
        '/tmp/all-files-parsed.log',
        `[FieldControl] Export names: ${allExports.map((exp) => exp.name).join(', ')}\n`,
      );
    }

    // Build typeNameMap from namespace members
    // For each namespace (e.g., "MenuRadioItem"), add entries for its members
    // E.g., "MenuRadioItemState" -> "Menu.RadioItem.State" (will be transformed later with namespace prefix)
    const typeNameMap = new Map<string, string>();

    // DEBUG: Log namespace members for Toolbar-related files
    if (
      sourceFile.fileName.includes('toolbar') ||
      sourceFile.fileName.includes('MenuBackdrop') ||
      sourceFile.fileName.includes('MenuRoot')
    ) {
      console.warn(
        '[parseExports] Building typeNameMap from namespaceMembers:',
        namespaceMembers.size,
      );
      console.warn('[parseExports] sourceFile:', sourceFile.fileName);
      console.warn(
        '[parseExports] Namespace members entries:',
        Array.from(namespaceMembers.entries()).map(([name, members]) => [
          name,
          Array.from(members.entries()),
        ]),
      );
    }

    // Also build a reverse map: memberName -> componentName for namespace member detection
    const memberToComponentMap = new Map<string, string>();

    Array.from(namespaceMembers.entries()).forEach(([componentName, members]) => {
      Array.from(members.entries()).forEach(([memberName, flatTypeName]) => {
        // DEBUG: Log entry creation for MenuBackdrop and MenuRoot
        if (
          sourceFile.fileName.includes('MenuBackdrop') ||
          sourceFile.fileName.includes('MenuRoot') ||
          componentName.includes('Separator')
        ) {
          console.warn('[parseExports] Creating typeNameMap entry:', {
            flatTypeName,
            componentName,
            memberName,
            mappedValue: `${componentName}.${memberName}`,
          });
        }

        // The flat name is like "MenuRadioItemState"
        // For now just map it to "ComponentName.MemberName", namespace prefix added later
        typeNameMap.set(flatTypeName, `${componentName}.${memberName}`);

        // Track which member names belong to which component
        if (componentName.includes('Separator') || memberName.includes('Separator')) {
          console.warn('[parseExports] Setting memberToComponentMap:', {
            memberName,
            componentName,
            fileName: sourceFile.fileName,
          });
        }
        memberToComponentMap.set(memberName, componentName);
      });

      // ALSO add the component name itself to the map (e.g., MenuRadioItem → Menu.RadioItem)
      // This is needed for references like "MenuRadioItem.State" where MenuRadioItem needs transformation
      // The namespace prefix will be added later during re-export processing
      if (members.size > 0) {
        // DEBUG: Log when adding component name for MenuRoot
        if (componentName.includes('Root') && sourceFile.fileName.includes('/menu/')) {
          console.warn('[parseExports] Adding component name to typeNameMap:', {
            componentName,
            membersSize: members.size,
            fileName: sourceFile.fileName,
          });
        }
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

    // DEBUG: Log final processed exports for MenuRoot.tsx
    if (sourceFile.fileName.includes('/menu/root/MenuRoot.tsx')) {
      console.warn('[parseExports] MenuRoot.tsx final processedExports:', processedExports.map((exp) => exp.name));
      const menuRootExport = processedExports.find((exp) => exp.name === 'MenuRoot' || exp.name.includes('Root'));
      if (menuRootExport) {
        console.warn('[parseExports] MenuRoot found in processedExports:', menuRootExport.name);
      } else {
        console.warn('[parseExports] MenuRoot NOT found in processedExports');
      }
    }

    allResults.push({
      name: '',
      exports: processedExports,
      typeNameMap,
      sourceFilePaths: [sourceFile.fileName],
    });
  }

  return allResults;
}
