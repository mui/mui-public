import { RuleTester } from '@typescript-eslint/rule-tester';
import TSESlintParser from '@typescript-eslint/parser';
import rule from './no-floating-cleanup.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: TSESlintParser,
    parserOptions: {
      tsconfigRootDir: import.meta.dirname,
      projectService: {
        allowDefaultProject: ['*.ts'],
      },
    },
  },
});

ruleTester.run('no-floating-cleanup', rule, {
  valid: [
    {
      name: 'stored cleanup function',
      code: `
type Unsubscribe = () => void;
declare function subscribe(cb: () => void): Unsubscribe;
function f() {
  const un = subscribe(() => {});
  un();
}
      `,
    },
    {
      name: 'explicit void opt-out',
      code: `
type Unsubscribe = () => void;
declare function subscribe(cb: () => void): Unsubscribe;
function f() {
  void subscribe(() => {});
}
      `,
    },
    {
      name: 'call returning void',
      code: `
declare function noop(): void;
function f() {
  noop();
}
      `,
    },
    {
      name: 'fluent builder methods returning `this`',
      code: `
interface Scale {
  (value: number): number;
  domain(d: number[]): this;
  range(r: number[]): this;
}
declare const scale: Scale;
function f() {
  scale.domain([0, 1]);
  scale.range([0, 100]);
}
      `,
    },
    {
      name: 'fluent builder method with an inferred `this` return',
      code: `
class Builder {
  configure() {
    return this;
  }
}
declare const builder: Builder;
function f() {
  builder.configure();
}
      `,
    },
  ],
  invalid: [
    {
      name: 'discarded unsubscribe function',
      code: `
type Unsubscribe = () => void;
declare function subscribe(cb: () => void): Unsubscribe;
function f() {
  subscribe(() => {});
}
      `,
      errors: [{ messageId: 'floatingCleanup', line: 5 }],
    },
    {
      name: 'call returning a fresh callable (not `this`)',
      code: `
interface Scale {
  (value: number): number;
  copy(): Scale;
}
declare const scale: Scale;
function f() {
  scale.copy();
}
      `,
      errors: [{ messageId: 'floatingCleanup', line: 8 }],
    },
    {
      name: 'discarded cleanup behind a unary operator',
      code: `
type Unsubscribe = () => void;
declare function subscribe(cb: () => void): Unsubscribe;
function f() {
  !subscribe(() => {});
}
      `,
      errors: [{ messageId: 'floatingCleanup', line: 5 }],
    },
    {
      name: 'discarded cleanup in a logical expression',
      code: `
type Unsubscribe = () => void;
declare function subscribe(cb: () => void): Unsubscribe;
declare const enabled: boolean;
function f() {
  enabled && subscribe(() => {});
}
      `,
      errors: [{ messageId: 'floatingCleanup', line: 6 }],
    },
    {
      name: 'discarded cleanup in a conditional expression',
      code: `
type Unsubscribe = () => void;
declare function subscribe(cb: () => void): Unsubscribe;
declare const enabled: boolean;
function f() {
  enabled ? subscribe(() => {}) : undefined;
}
      `,
      errors: [{ messageId: 'floatingCleanup', line: 6 }],
    },
  ],
});
