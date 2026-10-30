import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { processTypes } from './processTypes';
import type { VariantResult } from './processTypes';
import { matchConstantGroups } from './constantGroups';
import { isPublicComponent } from './formatComponent';

const projectDirs: string[] = [];

afterEach(() => {
  for (const dir of projectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Runs the types worker's processing over sources written to a temporary project, the way the
 * pipeline does. The first source is the entrypoint.
 */
async function processSources(sources: Record<string, string>): Promise<VariantResult> {
  const projectDir = mkdtempSync(path.join(tmpdir(), 'docs-infra-process-types-'));
  projectDirs.push(projectDir);
  for (const [name, text] of Object.entries(sources)) {
    const filePath = path.join(projectDir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, text);
  }

  const entrypoint = path.join(projectDir, Object.keys(sources)[0]);
  const response = await processTypes({
    projectPath: projectDir,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      rootDir: projectDir,
    },
    resolvedVariantMap: [['Default', pathToFileURL(entrypoint).href]],
    dependencies: [],
    rootContextDir: `${projectDir}/`,
    relativePath: 'types.md',
  });
  if (!response.success || !response.variantData) {
    throw new Error(response.error);
  }
  return response.variantData.Default;
}

describe('processTypes', () => {
  // Base UI declares a part as a value, a callable interface and a namespace of its types, then
  // exports it inside its component's namespace and, flat, through `export type *` of its file.
  it('documents a part exported both namespaced and through `export type *` once', async () => {
    const variant = await processSources({
      'index.ts': `
        export * as Dialog from './index.parts';
        export type * from './trigger';
        export * as DialogTriggerDataAttributes from './attributes';
      `,
      'index.parts.ts': `export { DialogTrigger as Trigger } from './trigger';`,
      'trigger.ts': `
        interface ReactElement {}
        export interface DialogTriggerState {
          open: boolean;
        }
        export interface DialogTriggerProps {
          className?: (state: DialogTrigger.State) => string;
        }
        export const DialogTrigger = ((props: DialogTrigger.Props) => ({})) as DialogTrigger;
        export interface DialogTrigger {
          (props: DialogTrigger.Props): ReactElement;
        }
        export namespace DialogTrigger {
          export type Props = DialogTriggerProps;
          export type State = DialogTriggerState;
        }
      `,
      'attributes.ts': `export const disabled = 'data-disabled';`,
    });

    expect(
      variant.exports.filter((node) => isPublicComponent(node)).map((node) => node.name),
    ).toEqual(['Dialog.Trigger']);
    expect(matchConstantGroups(variant.exports).targets.get('DialogTriggerDataAttributes')).toEqual(
      { component: 'Dialog.Trigger', kind: 'dataAttributes' },
    );
    expect(variant.typeNameMap).toMatchObject({
      DialogTriggerProps: 'Dialog.Trigger.Props',
      DialogTriggerState: 'Dialog.Trigger.State',
    });
  });
});
