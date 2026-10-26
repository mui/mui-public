import path from 'node:path';
import ts from 'typescript';

type InMemoryFiles = Record<string, string>;

export function createInMemoryProgram(
	filePath: string,
	sourceText: string,
	options?: ts.CompilerOptions,
): ts.Program;
export function createInMemoryProgram(
	files: InMemoryFiles,
	options?: ts.CompilerOptions,
): ts.Program;
export function createInMemoryProgram(
	filePathOrFiles: string | InMemoryFiles,
	sourceTextOrOptions?: string | ts.CompilerOptions,
	options: ts.CompilerOptions = {},
): ts.Program {
	const files =
		typeof filePathOrFiles === 'string'
			? { [filePathOrFiles]: sourceTextOrOptions as string }
			: filePathOrFiles;
	const rootNames = Object.keys(files);
	const compilerOptions: ts.CompilerOptions = {
		rootDir: path.dirname(rootNames[0]!),
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.Node16,
		moduleResolution: ts.ModuleResolutionKind.Node16,
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		...(typeof sourceTextOrOptions === 'string' ? options : sourceTextOrOptions),
	};
	const host = ts.createCompilerHost(compilerOptions);
	const getSourceFile = host.getSourceFile.bind(host);
	const directoryExists = host.directoryExists?.bind(host);

	host.getSourceFile = (sourceFileName, languageVersion, onError, shouldCreateNewSourceFile) => {
		const sourceText = files[sourceFileName];
		if (sourceText !== undefined) {
			return ts.createSourceFile(sourceFileName, sourceText, languageVersion, true);
		}

		return getSourceFile(sourceFileName, languageVersion, onError, shouldCreateNewSourceFile);
	};
	host.fileExists = (sourceFileName) =>
		files[sourceFileName] !== undefined || ts.sys.fileExists(sourceFileName);
	host.readFile = (sourceFileName) => files[sourceFileName] ?? ts.sys.readFile(sourceFileName);
	host.directoryExists = (directoryName) =>
		hasInMemoryFileInDirectory(directoryName, files) ||
		directoryExists?.(directoryName) ||
		ts.sys.directoryExists(directoryName);
	host.resolveModuleNameLiterals = (
		moduleLiterals,
		containingFile,
		redirectedReference,
		resolutionOptions = compilerOptions,
		containingSourceFile,
	) =>
		moduleLiterals.map((moduleLiteral) =>
			resolveModule(
				moduleLiteral.text,
				containingFile,
				files,
				resolutionOptions,
				host,
				redirectedReference,
				ts.getModeForUsageLocation(containingSourceFile, moduleLiteral, resolutionOptions),
			),
		);

	return ts.createProgram(rootNames, compilerOptions, host);
}

function resolveInMemoryModule(
	moduleName: string,
	containingFile: string,
	files: InMemoryFiles,
): ts.ResolvedModuleWithFailedLookupLocations | undefined {
	for (const extension of supportedExtensions) {
		const candidate = path.resolve(path.dirname(containingFile), `${moduleName}${extension}`);
		if (files[candidate] !== undefined) {
			return {
				resolvedModule: {
					resolvedFileName: candidate,
					extension: extensionKinds[extension],
				},
			};
		}
	}

	return undefined;
}

function resolveModule(
	moduleName: string,
	containingFile: string,
	files: InMemoryFiles,
	compilerOptions: ts.CompilerOptions,
	host: ts.ModuleResolutionHost,
	redirectedReference: ts.ResolvedProjectReference | undefined,
	resolutionMode: ts.ResolutionMode,
): ts.ResolvedModuleWithFailedLookupLocations {
	const inMemoryModule = resolveInMemoryModule(moduleName, containingFile, files);
	if (inMemoryModule) {
		return inMemoryModule;
	}

	// The in-memory lookup only covers simple relative virtual files. Delegate
	// everything else back to TypeScript so package imports, `paths` mappings,
	// and lib resolution behave the same way they do in real programs.
	return ts.resolveModuleName(
		moduleName,
		containingFile,
		compilerOptions,
		host,
		undefined,
		redirectedReference,
		resolutionMode,
	);
}

function hasInMemoryFileInDirectory(directoryName: string, files: InMemoryFiles): boolean {
	const normalizedDirectoryName = path.resolve(directoryName);

	// TypeScript's resolver checks directories before probing candidate files.
	// Virtual path-mapped modules therefore need their containing directories to
	// exist from the resolver's point of view, even though they are not on disk.
	return Object.keys(files).some((fileName) =>
		path.resolve(fileName).startsWith(`${normalizedDirectoryName}${path.sep}`),
	);
}

const supportedExtensions = ['.ts', '.tsx', '.d.ts'] as const;
const extensionKinds: Record<(typeof supportedExtensions)[number], ts.Extension> = {
	'.ts': ts.Extension.Ts,
	'.tsx': ts.Extension.Tsx,
	'.d.ts': ts.Extension.Dts,
};
