import eslint from 'eslint';
import TSESlintParser from '@typescript-eslint/parser';
import path from 'node:path';
import { test, describe, it } from 'vitest';
import rule from './no-direct-state-access.mjs';

eslint.RuleTester.describe = describe;
eslint.RuleTester.it = it;
eslint.RuleTester.itOnly = it.only;

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser: TSESlintParser,
    parserOptions: {
      tsconfigRootDir: path.join(__dirname, '../fixtures'),
      project: './tsconfig.json',
    },
  },
});

test('mui-no-direct-state-access', () => {
  ruleTester.run('mui-no-direct-state-access', rule, {
    valid: [
      {
        name: 'assigning received grid state to a variable',
        code: `
const useCustomHook = (apiRef: GridApiRef) => {
  const state = apiRef.current.state;
}
    `,
      },
      {
        name: 'accessing any state directly',
        code: `
      const useCustomHook = (api: any) => {
        const rows = api.current.state.rows;
      }
          `,
      },
      {
        name: 'passing any state to a function',
        code: `
      const useCustomHook = (api: any) => {
        const rows = gridRowsSelector(api.current.state);
      }
          `,
      },
    ],
    invalid: [
      {
        name: 'directly accessing variable inside received grid state',
        code: `
      type GridApiRef = React.MutableRefObject<any>;
      const useCustomHook = (apiRef: GridApiRef) => {
        const rows = apiRef.current.state.rows;
      }
                `,
        errors: [{ messageId: 'direct-access', line: 4, column: 16 }],
      },
      {
        name: 'directly accessing variable inside grid state from the hook context',
        code: `
      type GridApiRef = React.MutableRefObject<any>;
      const useGridApiContext = (): GridApiRef => { return {} };
      const useCustomHook = () => {
        const apiRef = useGridApiContext();
        const rows = apiRef.current.state.rows;
      }
                `,
        errors: [{ messageId: 'direct-access', line: 6, column: 16 }],
      },
      {
        name: 'destructuring variable from grid state',
        code: `
      type GridApiRef = React.MutableRefObject<any>;
      const useGridApiContext = (): GridApiRef => { return {} };
      const useCustomHook = () => {
        const apiRef = useGridApiContext();
        const { rows } = apiRef.current.state;
      }
                `,
        errors: [{ messageId: 'direct-access', line: 6, column: 9 }],
      },
    ],
  });
});
