/* eslint-disable no-bitwise -- TypeScript type and symbol flags are bitmasks */
import ts from 'typescript';
import { parseFromProgram, withTypeName } from 'typescript-api-extractor';
import type { ExportNode, ParserOptions } from 'typescript-api-extractor';
import { collectExportSymbols, resolveAlias } from './collectExportSymbols';

const COMPANION_PREFIX = '__docsSubstituted_';

interface Candidate {
  exportName: string;
  declaration: ts.TypeAliasDeclaration;
  testedParameters: Set<ts.TypeParameterDeclaration>;
  companionName: string;
  companionDeclaration: string;
}

/**
 * Re-resolves generic type aliases whose body is a conditional type that tests their own
 * type parameters. Left generic, TypeScript cannot pick a branch of such a conditional, so
 * the extractor merges every branch into one misleading shape. Each tested type parameter
 * is replaced by its default, else its constraint, else `unknown`, which lets TypeScript
 * choose a branch. Untested type parameters stay generic, and the export keeps its
 * original name and type parameter list.
 *
 * Set `DEBUG_DOCS_INFRA_SUBSTITUTION` to log one line per candidate: the entrypoint, the
 * export, the companion alias it was resolved through, and whether the result was applied
 * or why it was skipped.
 */
export function substituteConditionalTypeParameters(
  exports: ExportNode[],
  entrypoint: string,
  program: ts.Program,
  parserOptions: ParserOptions,
): ExportNode[] {
  const entrySourceFile = program.getSourceFile(entrypoint);
  const moduleSymbol =
    entrySourceFile && program.getTypeChecker().getSymbolAtLocation(entrySourceFile);
  if (!moduleSymbol) {
    return exports;
  }

  const exportNames = new Set(exports.map((exportNode) => exportNode.name));
  const candidates = findCandidates(moduleSymbol, program, exportNames);
  if (candidates.length === 0) {
    return exports;
  }

  const candidatesByFile = new Map<ts.SourceFile, Candidate[]>();
  for (const candidate of candidates) {
    const sourceFile = candidate.declaration.getSourceFile();
    const fileCandidates = candidatesByFile.get(sourceFile);
    if (fileCandidates) {
      fileCandidates.push(candidate);
    } else {
      candidatesByFile.set(sourceFile, [candidate]);
    }
  }

  const substitutedProgram = createProgramWithCompanions(program, candidatesByFile);
  const substitutedTypes = new Map<string, ExportNode['type']>();
  const outcomes = new Map<string, string>();
  for (const [sourceFile, fileCandidates] of candidatesByFile) {
    if (hasCompanionErrors(substitutedProgram, sourceFile)) {
      for (const candidate of fileCandidates) {
        outcomes.set(candidate.exportName, 'skipped: companion does not type-check');
      }
      continue;
    }

    const candidatesByCompanion = new Map(
      fileCandidates.map((candidate) => [candidate.companionName, candidate]),
    );
    const parsed = parseFromProgram(sourceFile.fileName, substitutedProgram, parserOptions);
    for (const companionExport of parsed.exports) {
      const candidate = candidatesByCompanion.get(companionExport.name);
      if (candidate) {
        substitutedTypes.set(candidate.exportName, companionExport.type);
      }
    }
  }

  const result = exports.map((exportNode) => {
    const substitutedType = substitutedTypes.get(exportNode.name);
    if (!substitutedType) {
      return exportNode;
    }

    const originalTypeName = 'typeName' in exportNode.type ? exportNode.type.typeName : undefined;
    if (!originalTypeName) {
      outcomes.set(exportNode.name, 'skipped: original export has no type name');
      return exportNode;
    }
    // `any` means the conditional collapsed, as over React's `ElementType`, so the original
    // rendering says more.
    if (substitutedType.kind === 'intrinsic' && substitutedType.intrinsic === 'any') {
      outcomes.set(exportNode.name, 'skipped: resolves to any');
      return exportNode;
    }

    outcomes.set(exportNode.name, 'applied');
    return exportNode.withType(withTypeName(substitutedType, originalTypeName));
  });

  if (process.env.DEBUG_DOCS_INFRA_SUBSTITUTION) {
    for (const candidate of candidates) {
      console.error(
        `[substitute] ${entrypoint} ${candidate.exportName}: ${candidate.companionDeclaration} ${
          outcomes.get(candidate.exportName) ?? 'skipped: companion not resolved'
        }`,
      );
    }
  }

  return result;
}

function findCandidates(
  moduleSymbol: ts.Symbol,
  program: ts.Program,
  exportNames: Set<string>,
): Candidate[] {
  const checker = program.getTypeChecker();
  const candidates: Candidate[] = [];
  for (const [exportName, exportSymbol] of collectExportSymbols(moduleSymbol, checker)) {
    const declaration = exportNames.has(exportName)
      ? resolveAlias(exportSymbol, checker).declarations?.find(ts.isTypeAliasDeclaration)
      : undefined;
    if (!declaration?.typeParameters?.length) {
      continue;
    }

    const testedParameters = getTestedTypeParameters(declaration, program);
    if (testedParameters.size > 0) {
      const companionName = `${COMPANION_PREFIX}${exportName.replaceAll('.', '_')}`;
      candidates.push({
        exportName,
        declaration,
        testedParameters,
        companionName,
        companionDeclaration: createCompanionDeclaration(
          declaration,
          testedParameters,
          companionName,
        ),
      });
    }
  }

  return candidates;
}

/**
 * The type parameters of an alias that its resolved type tests in an unresolved
 * conditional. Following the resolved type rather than the syntax covers aliases that
 * pass their parameters on to a conditional alias, such as `type Cell<Row, Columns> =
 * RowCell<Row, Columns>`. Only conditionals written in the project count: one inside a
 * dependency, like React's `ComponentPropsWithRef`, is not part of the documented API.
 */
function getTestedTypeParameters(
  declaration: ts.TypeAliasDeclaration,
  program: ts.Program,
): Set<ts.TypeParameterDeclaration> {
  const checker = program.getTypeChecker();
  const aliasType = checker.getTypeAtLocation(declaration.name);
  if (!(aliasType.flags & ts.TypeFlags.Conditional)) {
    return new Set();
  }

  const conditional = aliasType as ts.ConditionalType;
  if (isFromDependency(conditional.root.node.getSourceFile(), program)) {
    return new Set();
  }

  const referenced = new Set<ts.Type>();
  collectTypeParameters(conditional.checkType, checker, referenced, new Set());

  return new Set(
    (declaration.typeParameters ?? []).filter((parameter) =>
      referenced.has(checker.getTypeAtLocation(parameter.name)),
    ),
  );
}

function isFromDependency(sourceFile: ts.SourceFile, program: ts.Program): boolean {
  return (
    program.isSourceFileFromExternalLibrary(sourceFile) ||
    program.isSourceFileDefaultLibrary(sourceFile)
  );
}

function collectTypeParameters(
  type: ts.Type,
  checker: ts.TypeChecker,
  referenced: Set<ts.Type>,
  visited: Set<ts.Type>,
): void {
  if (visited.has(type)) {
    return;
  }
  visited.add(type);

  if (type.flags & ts.TypeFlags.TypeParameter) {
    referenced.add(type);
  }
  if (type.flags & ts.TypeFlags.Conditional) {
    const conditional = type as ts.ConditionalType;
    collectTypeParameters(conditional.checkType, checker, referenced, visited);
    collectTypeParameters(conditional.extendsType, checker, referenced, visited);
  }
  if (type.isUnionOrIntersection()) {
    for (const member of type.types) {
      collectTypeParameters(member, checker, referenced, visited);
    }
  }
  if (type.flags & ts.TypeFlags.IndexedAccess) {
    const indexedAccess = type as ts.IndexedAccessType;
    collectTypeParameters(indexedAccess.objectType, checker, referenced, visited);
    collectTypeParameters(indexedAccess.indexType, checker, referenced, visited);
  }
  if (type.flags & ts.TypeFlags.Index) {
    collectTypeParameters((type as ts.IndexType).type, checker, referenced, visited);
  }
  for (const argument of type.aliasTypeArguments ?? []) {
    collectTypeParameters(argument, checker, referenced, visited);
  }
  if (
    type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
  ) {
    for (const argument of checker.getTypeArguments(type as ts.TypeReference)) {
      collectTypeParameters(argument, checker, referenced, visited);
    }
  }
}

/**
 * Appends one companion alias per candidate to its declaring file, so constraints and
 * defaults resolve against the same names the original declaration sees:
 * `export type __docsSubstituted_Cell<Row> = Cell<Row, readonly { id: string }[]>;`
 */
function createProgramWithCompanions(
  program: ts.Program,
  candidatesByFile: Map<ts.SourceFile, Candidate[]>,
): ts.Program {
  const options = program.getCompilerOptions();
  const replacedTexts = new Map<string, string>();
  for (const [sourceFile, fileCandidates] of candidatesByFile) {
    const companions = fileCandidates.map((candidate) => candidate.companionDeclaration);
    replacedTexts.set(sourceFile.fileName, `${sourceFile.text}\n${companions.join('\n')}\n`);
  }

  const directories = new Set<string>();
  for (const sourceFile of program.getSourceFiles()) {
    for (
      let directory = sourceFile.fileName.slice(0, sourceFile.fileName.lastIndexOf('/'));
      directory && !directories.has(directory);
      directory = directory.slice(0, directory.lastIndexOf('/'))
    ) {
      directories.add(directory);
    }
  }

  // Files of the original program are served from it, so the new program reuses them and
  // a program built over in-memory sources keeps resolving them.
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    const replacedText = replacedTexts.get(fileName);
    if (replacedText !== undefined) {
      return ts.createSourceFile(fileName, replacedText, languageVersionOrOptions, true);
    }
    return (
      getOriginalSourceFile(program, fileName) ??
      getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
    );
  };
  host.fileExists = (fileName) =>
    program.getSourceFile(fileName) !== undefined || fileExists(fileName);
  host.directoryExists = (directoryName) =>
    directories.has(directoryName) || (directoryExists?.(directoryName) ?? true);
  host.readFile = (fileName) =>
    replacedTexts.get(fileName) ?? program.getSourceFile(fileName)?.text ?? readFile(fileName);

  return ts.createProgram({
    rootNames: program.getRootFileNames(),
    options,
    host,
    oldProgram: program,
  });
}

/**
 * A duplicate copy of a package's file is a redirect, which a host must not return. Its
 * unredirected file is what program reuse expects instead. TypeScript only exposes this
 * through the internal `redirectInfo`.
 */
function getOriginalSourceFile(program: ts.Program, fileName: string): ts.SourceFile | undefined {
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile && 'redirectInfo' in sourceFile) {
    const { redirectInfo } = sourceFile as { redirectInfo?: { unredirected: ts.SourceFile } };
    return redirectInfo ? redirectInfo.unredirected : sourceFile;
  }
  return sourceFile;
}

function createCompanionDeclaration(
  declaration: ts.TypeAliasDeclaration,
  testedParameters: Set<ts.TypeParameterDeclaration>,
  companionName: string,
): string {
  const parameters = declaration.typeParameters ?? [];
  const keptParameters = parameters
    .filter((parameter) => !testedParameters.has(parameter))
    .map((parameter) => parameter.getText());
  const typeArguments = parameters.map((parameter) =>
    testedParameters.has(parameter)
      ? ((parameter.default ?? parameter.constraint)?.getText() ?? 'unknown')
      : parameter.name.text,
  );
  const parameterList = keptParameters.length > 0 ? `<${keptParameters.join(', ')}>` : '';

  return `export type ${companionName}${parameterList} = ${getQualifiedName(declaration)}<${typeArguments.join(', ')}>;`;
}

function getQualifiedName(declaration: ts.TypeAliasDeclaration): string {
  const names = [declaration.name.text];
  for (let parent = declaration.parent; !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isModuleDeclaration(parent) && ts.isIdentifier(parent.name)) {
      names.unshift(parent.name.text);
    }
  }

  return names.join('.');
}

/**
 * A substituted default or constraint can stop type-checking, for example when it refers
 * to another substituted parameter. Such companions are skipped and their exports keep
 * their original rendering.
 */
function hasCompanionErrors(program: ts.Program, originalSourceFile: ts.SourceFile): boolean {
  const sourceFile = program.getSourceFile(originalSourceFile.fileName);
  if (!sourceFile) {
    return true;
  }

  return program
    .getSemanticDiagnostics(sourceFile)
    .some(
      (diagnostic) =>
        diagnostic.start !== undefined && diagnostic.start >= originalSourceFile.text.length,
    );
}
