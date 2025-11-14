import * as fs from 'node:fs/promises';
import { globby } from 'globby';
import ts from 'typescript';
import { mapConcurrently } from './build.mjs';

/**
 * Check if a type node contains undefined by analyzing the type structure
 * and resolving type references using the type checker
 *
 * @param {ts.TypeNode} typeNode
 * @param {ts.TypeChecker} checker
 * @returns {boolean}
 */
export function containsUndefined(typeNode, checker) {
  // Direct undefined keyword
  if (typeNode.kind === ts.SyntaxKind.UndefinedKeyword) {
    return true;
  }

  // Literal undefined
  if (ts.isLiteralTypeNode(typeNode) && typeNode.literal.kind === ts.SyntaxKind.UndefinedKeyword) {
    return true;
  }

  // Parenthesized type, eg, type A = (string | number);  // parenthesized union type
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return containsUndefined(typeNode.type, checker);
  }

  // Union type - check each member
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.some((t) => containsUndefined(t, checker));
  }

  // Type reference (e.g., imported types, type aliases)
  // Need to resolve the symbol to check if it's a type alias that includes undefined
  if (ts.isTypeReferenceNode(typeNode)) {
    // Try to get the symbol and resolve type aliases
    const symbol = checker.getSymbolAtLocation(typeNode.typeName);
    if (symbol && symbol.declarations && symbol.declarations.length > 0) {
      const decl = symbol.declarations[0];
      // If it's a type alias, recursively check the aliased type
      if (ts.isTypeAliasDeclaration(decl) && decl.type) {
        return containsUndefined(decl.type, checker);
      }
    }

    // Fallback: check the resolved type
    const type = checker.getTypeFromTypeNode(typeNode);
    if (type.isUnion()) {
      return type.types.some((t) => {
        // eslint-disable-next-line no-bitwise
        return (t.flags & ts.TypeFlags.Undefined) !== 0;
      });
    }

    // eslint-disable-next-line no-bitwise
    return (type.flags & ts.TypeFlags.Undefined) !== 0;
  }

  return false;
}

/**
 * Adds the undefined type to the given type node.
 * @param {ts.NodeFactory} factory
 * @param {ts.TypeNode} typeNode
 * @returns {ts.TypeNode}
 */
export function addUndefinedToType(factory, typeNode) {
  const undefinedNode = factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword);

  if (ts.isUnionTypeNode(typeNode)) {
    const unionMembers = [...typeNode.types, undefinedNode];
    return factory.createUnionTypeNode(unionMembers);
  }

  return factory.createUnionTypeNode([typeNode, undefinedNode]);
}

/**
 * Create a TypeScript transformer that adds explicit undefined to optional properties. Exported for testing.
 * @param {ts.TypeChecker} checker
 * @returns {ts.TransformerFactory<ts.SourceFile>}
 */
function createTransformer(checker) {
  return (context) => {
    const { factory } = context;

    /**
     * @type {ts.Visitor}
     */
    const visitor = (node) => {
      if (
        (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
        node.questionToken &&
        node.type &&
        !containsUndefined(node.type, checker)
      ) {
        const updatedType = addUndefinedToType(factory, node.type);

        if (ts.isPropertySignature(node)) {
          return factory.updatePropertySignature(
            node,
            node.modifiers,
            node.name,
            node.questionToken,
            updatedType,
          );
        }

        return factory.updatePropertyDeclaration(
          node,
          node.modifiers,
          node.name,
          node.questionToken,
          updatedType,
          node.initializer,
        );
      }

      return ts.visitEachChild(node, visitor, context);
    };

    return (node) => /** @type {ts.SourceFile} */ (ts.visitNode(node, visitor));
  };
}

/**
 * Transform a source file by adding explicit undefined to optional properties.
 * @param {ts.SourceFile} sourceFile
 * @param {ts.TypeChecker} checker
 * @param {ts.Printer} printer
 * @returns {string} The transformed source code
 */
export function transformSourceFile(sourceFile, checker, printer) {
  const result = ts.transform(sourceFile, [createTransformer(checker)]);
  const [transformedFile] = result.transformed;
  result.dispose();

  return printer.printFile(transformedFile);
}

/**
 * @param {string} filePath
 * @param {ts.Program} program
 * @param {ts.Printer} printer
 * @returns {Promise<void>}
 */
async function processFile(filePath, program, printer) {
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) {
    return;
  }

  const checker = program.getTypeChecker();
  await fs.writeFile(filePath, transformSourceFile(sourceFile, checker, printer));
}

/**
 * @param {string} dtsDirectory
 */
export async function tsAddExplicitUndefined(dtsDirectory) {
  const dtsFiles = await globby('**/*.d.*', {
    absolute: true,
    cwd: dtsDirectory,
  });
  if (dtsFiles.length === 0) {
    console.warn(`No .d.ts files found in directory: ${dtsDirectory}`);
    return;
  }
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const program = ts.createProgram(dtsFiles, {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    allowJs: false,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
  });

  await mapConcurrently(dtsFiles, async (filePath) => processFile(filePath, program, printer), 20);
}
