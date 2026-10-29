import { describe, it, expect } from 'vitest';
import { dropTypeOnlyDuplicates } from './dropTypeOnlyDuplicates';
import { parseTestSources } from './parseTestSources';

// A part declared the way Base UI declares generic parts: a value, a callable interface of the
// same name, and a namespace of its types.
const DIALOG_SOURCES = {
  'parts.ts': `export { DialogTrigger as Trigger } from './trigger';`,
  'trigger.ts': `
    export const DialogTrigger = ((props: DialogTrigger.Props) => ({})) as DialogTrigger;
    export interface DialogTrigger {
      (props: DialogTrigger.Props): ReactElement;
    }
    export namespace DialogTrigger {
      export interface Props {
        label: string;
      }
    }
  `,
};

function exportNames(sources: Record<string, string>) {
  return dropTypeOnlyDuplicates(
    parseTestSources(sources, { lib: `interface ReactElement {}` }),
  ).map((node) => node.name);
}

describe('dropTypeOnlyDuplicates', () => {
  it('drops type-only exports that repeat a namespaced re-export', () => {
    expect(
      exportNames({
        'index.ts': `
          export * as Dialog from './parts';
          export type * from './trigger';
        `,
        ...DIALOG_SOURCES,
      }),
    ).toEqual(['Dialog.Trigger', 'Dialog.Trigger.Props']);
  });

  it('keeps a plain flat type next to its namespaced re-export', () => {
    expect(
      exportNames({
        'index.ts': `
          export * as Progress from './parts';
          export type * from './status';
        `,
        'parts.ts': `export type { ProgressStatus as Status } from './status';`,
        'status.ts': `export type ProgressStatus = 'indeterminate' | 'complete';`,
      }),
    ).toEqual(['Progress.Status', 'ProgressStatus']);
  });

  it('keeps a component exported as a value under both names, but not its repeated types', () => {
    expect(
      exportNames({
        'index.ts': `
          export * as Dialog from './parts';
          export { DialogTrigger } from './trigger';
        `,
        ...DIALOG_SOURCES,
      }),
    ).toEqual(['Dialog.Trigger', 'Dialog.Trigger.Props', 'DialogTrigger']);
  });
});
