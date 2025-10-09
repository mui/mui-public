// webpack doesn't like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs/promises';
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
import ts from 'typescript';

function mergeConfig(target: any, source: any): any {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (
        typeof target[key] === 'object' &&
        target[key] !== null &&
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(target[key]) &&
        !Array.isArray(source[key])
      ) {
        mergeConfig(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }

  return target;
}

export async function loadTypescriptConfig(configPath: string) {
  const dependencies = [configPath];
  const projectPath = new URL('.', `file://${configPath}`).pathname;

  const data = await fs.readFile(configPath, 'utf-8');
  const { config, error } = ts.readConfigFile(configPath, (filePath) => {
    if (filePath !== configPath) {
      throw new Error(`Unexpected file path: ${filePath}`);
    }

    return data.toString();
  });

  if (error) {
    throw error;
  }

  const { options, errors, raw } = ts.parseJsonConfigFileContent(config, ts.sys, projectPath);
  options.configFilePath = configPath;

  let mergedConfig = options;
  if (raw.extends) {
    const {
      options: parentOptions,
      projectPath: parentPath,
      dependencies: parentDependencies,
    } = await loadTypescriptConfig(new URL(raw.extends, `file://${configPath}`).pathname);

    dependencies.push(...parentDependencies);

    // scope compilerOptions.paths relative to the tsconfig location
    if (parentOptions.paths) {
      Object.keys(parentOptions.paths).forEach((key) => {
        if (!parentOptions.paths) {
          return;
        }

        const paths: string[] = [];
        parentOptions.paths[key].forEach((relativePath: string) => {
          const absolutePath = new URL(relativePath, `file://${parentPath}`).pathname;
          let scopedPath = path.relative(projectPath, absolutePath);
          if (!scopedPath.startsWith('.')) {
            scopedPath = `./${scopedPath}`;
          }
          paths.push(scopedPath);
        });
        parentOptions.paths[key] = paths;
      });
    }

    mergedConfig = mergeConfig(parentOptions, mergedConfig);
  }

  if (errors.length > 0) {
    throw errors[0];
  }

  return { projectPath, options: mergedConfig, dependencies };
}
