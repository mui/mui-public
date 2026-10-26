import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads and parses a `tsconfig` file and returns a `ts.CompilerOptions` object
 * @param tsConfigPath The location for a `tsconfig.json` file
 */
export function loadConfig(tsConfigPath: string) {
	const resolvedConfigPath = path.resolve(tsConfigPath);
	const projectDirectory = path.dirname(resolvedConfigPath);

	const { config, error } = ts.readConfigFile(tsConfigPath, (filePath) =>
		fs.readFileSync(filePath).toString(),
	);

	if (error) throw error;

	const { options, errors, fileNames } = ts.parseJsonConfigFileContent(
		config,
		ts.sys,
		projectDirectory,
	);

	if (errors.length > 0) throw errors[0];

	return { options, fileNames };
}
