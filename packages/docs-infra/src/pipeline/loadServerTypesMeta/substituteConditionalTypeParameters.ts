/* eslint-disable no-bitwise -- TypeScript type and symbol flags are bitmasks */
import ts from 'typescript';
import { parseFromProgram, withTypeName } from 'typescript-api-extractor';
import type { ExportNode, ParserOptions } from 'typescript-api-extractor';

const COMPANION_PREFIX = '__docsSubstituted';

interface Candidate {
  exportName: string;
  declaration: ts.TypeAliasDeclaration;
  testedParameters: Set<ts.TypeParameterDeclaration>;
  companionName: string;
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
 * export, the companion alias it was resolved through, and whether the result was applied.
 */
export function substituteConditionalTypeParameters(
  exports: ExportNode[],
  entrypoint: string,
  program: ts.Program,
  parserOptions: ParserOptions,
): ExportNode[] {
  const checker = program.getTypeChecker();
  const entrySourceFile = program.getSourceFile(entrypoint);
  const moduleSymbol = entrySourceFile && checker.getSymbolAtLocation(entrySourceFile);
  if (!moduleSymbol) {
    return exports;
  }

  const exportNames = new Set(exports.map((exportNode) => exportNode.name));
  const candidates = findCandidates(moduleSymbol, program, exportNames);
  if (candidates.length === 0) {
    return exports;
  }

  const companionsByFile = new Map<ts.SourceFile, Candidate[]>();
  for (const candidate of candidates) {
    const sourceFile = candidate.declaration.getSourceFile();
    companionsByFile.set(sourceFile, [...(companionsByFile.get(sourceFile) ?? []), candidate]);
  }

  const substitutedProgram = createProgramWithCompanions(program, companionsByFile);
  const substitutedTypes = new Map<string, ExportNode['type']>();
  for (const [sourceFile, fileCandidates] of companionsByFile) {
    if (hasCompanionErrors(substitutedProgram, sourceFile, fileCandidates)) {
      continue;
    }

    const companionNames = new Set(fileCandidates.map((candidate) => candidate.companionName));
    const parsed = parseFromProgram(sourceFile.fileName, substitutedProgram, parserOptions);
    for (const companionExport of parsed.exports) {
      if (companionNames.has(companionExport.name)) {
        substitutedTypes.set(companionExport.name, companionExport.type);
      }
    }
  }

  if (process.env.DEBUG_DOCS_INFRA_SUBSTITUTION) {
    for (const candidate of candidates) {
      console.error(
        `[substitute] ${entrypoint} ${candidate.exportName}: ${createCompanionDeclaration(candidate)} ${
          substitutedTypes.has(candidate.companionName) ? 'applied' : 'skipped'
        }`,
      );
    }
  }

  const companionNameByExport = new Map(
    candidates.map((candidate) => [candidate.exportName, candidate.companionName]),
  );

  return exports.map((exportNode) => {
    const companionName = companionNameByExport.get(exportNode.name);
    const substitutedType = companionName && substitutedTypes.get(companionName);
    const originalTypeName = 'typeName' in exportNode.type ? exportNode.type.typeName : undefined;
    // `any` means the conditional collapsed, as over React's `ElementType`, so the original
    // rendering says more.
    if (!substitutedType || !originalTypeName || isAny(substitutedType)) {
      return exportNode;
    }

    return exportNode.withType(withTypeName(substitutedType, originalTypeName));
  });
}

function isAny(type: ExportNode['type']): boolean {
  return type.kind === 'intrinsic' && type.intrinsic === 'any';
}

function findCandidates(
  moduleSymbol: ts.Symbol,
  program: ts.Program,
  exportNames: Set<string>,
): Candidate[] {
  const checker = program.getTypeChecker();
  const candidates: Candidate[] = [];
  const visit = (containerSymbol: ts.Symbol, prefix: string, visited: Set<ts.Symbol>) => {
    for (const exportSymbol of checker.getExportsOfModule(containerSymbol)) {
      const symbol =
        exportSymbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exportSymbol)
          : exportSymbol;
      const exportName = prefix + exportSymbol.name;

      const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
      if (declaration?.typeParameters?.length && exportNames.has(exportName)) {
        const testedParameters = getTestedTypeParameters(declaration, program);
        if (testedParameters.size > 0) {
          candidates.push({
            exportName,
            declaration,
            testedParameters,
            companionName: `${COMPANION_PREFIX}${candidates.length}`,
          });
        }
      }

      if (symbol.flags & ts.SymbolFlags.Namespace && !visited.has(symbol)) {
        visit(symbol, `${exportName}.`, new Set([...visited, symbol]));
      }
    }
  };

  visit(moduleSymbol, '', new Set([moduleSymbol]));
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
  if (
    !(aliasType.flags & ts.TypeFlags.Conditional) ||
    isFromDependency((aliasType as ts.ConditionalType).root.node.getSourceFile(), program)
  ) {
    return new Set();
  }

  const referenced = new Set<ts.Type>();
  collectTypeParameters(
    (aliasType as ts.ConditionalType).checkType,
    checker,
    referenced,
    new Set(),
  );

  return new Set(
    (declaration.typeParameters ?? []).filter((parameter) =>
      referenced.has(checker.getTypeAtLocation(parameter.name)),
    ),
  );
}

function isFromDependency(sourceFile: ts.SourceFile, program: ts.Program): boolean {
  return (
    program.isSourceFileFromExternalLibrary(sourceFile) ||
    program.isSourceFileDefaultLibrary(sourceFile) ||
    sourceFile.fileName.includes('/node_modules/')
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
 * `export type __docsSubstituted0<Row> = Cell<Row, readonly { id: string }[]>;`
 */
function createProgramWithCompanions(
  program: ts.Program,
  companionsByFile: Map<ts.SourceFile, Candidate[]>,
): ts.Program {
  const options = program.getCompilerOptions();
  const replacedFiles = new Map<string, ts.SourceFile>();
  for (const [sourceFile, fileCandidates] of companionsByFile) {
    const companions = fileCandidates.map(createCompanionDeclaration).join('\n');
    replacedFiles.set(
      sourceFile.fileName,
      ts.createSourceFile(
        sourceFile.fileName,
        `${sourceFile.text}\n${companions}\n`,
        sourceFile.languageVersion,
        true,
      ),
    );
  }

  // Files of the original program are served from it, so a program built over in-memory
  // sources keeps resolving them. Duplicate package copies are redirects to another source
  // file, which a host must not return; the program recreates those itself.
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getOriginalSourceFile = (fileName: string) => {
    const sourceFile = program.getSourceFile(fileName);
    return sourceFile && !isRedirectSourceFile(sourceFile) ? sourceFile : undefined;
  };
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    replacedFiles.get(fileName) ??
    getOriginalSourceFile(fileName) ??
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = (fileName) =>
    program.getSourceFile(fileName) !== undefined || fileExists(fileName);
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (directoryName) =>
    program
      .getSourceFiles()
      .some((sourceFile) => sourceFile.fileName.startsWith(`${directoryName}/`)) ||
    (directoryExists?.(directoryName) ?? true);
  host.readFile = (fileName) =>
    replacedFiles.get(fileName)?.text ??
    program.getSourceFile(fileName)?.text ??
    readFile(fileName);

  return ts.createProgram({
    rootNames: program.getRootFileNames(),
    options,
    host,
    oldProgram: program,
  });
}

/**
 * TypeScript marks a duplicate copy of a package's file with internal `redirectInfo`;
 * there is no public API for it.
 */
function isRedirectSourceFile(sourceFile: ts.SourceFile): boolean {
  return 'redirectInfo' in sourceFile && sourceFile.redirectInfo !== undefined;
}

function createCompanionDeclaration(candidate: Candidate): string {
  const { declaration, testedParameters, companionName } = candidate;
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
 * to another substituted parameter. Such a companion is skipped and the export keeps its
 * original rendering.
 */
function hasCompanionErrors(
  program: ts.Program,
  originalSourceFile: ts.SourceFile,
  fileCandidates: Candidate[],
): boolean {
  const sourceFile = program.getSourceFile(originalSourceFile.fileName);
  if (!sourceFile || fileCandidates.length === 0) {
    return true;
  }

  return program
    .getSemanticDiagnostics(sourceFile)
    .some(
      (diagnostic) =>
        diagnostic.start !== undefined && diagnostic.start >= originalSourceFile.text.length,
    );
}
