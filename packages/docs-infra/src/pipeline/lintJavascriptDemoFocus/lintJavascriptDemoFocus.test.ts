import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import parser from '@typescript-eslint/parser';
import { lintJavascriptDemoFocus } from './lintJavascriptDemoFocus';

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

describe('lintJavascriptDemoFocus', () => {
  // eslint-disable-next-line vitest/expect-expect -- RuleTester uses its own assertion library
  it('should pass RuleTester', () => {
    ruleTester.run('require-demo-focus', lintJavascriptDemoFocus, {
      valid: [
        // File already has @highlight-start with @focus — skip
        {
          code: `
{/* @highlight-start @focus */}
export default function Demo() {
  return <div>Hello</div>;
}
{/* @highlight-end */}
          `,
        },
        // File already has @focus — skip
        {
          code: `
// @focus-start
export default function Demo() {
  return <div>Hello</div>;
}
// @focus-end
          `,
        },
        // No export default, named export doesn't match filename, multiple exports
        {
          filename: 'Other.tsx',
          code: `
export function Foo() {
  return <div>Hello</div>;
}
export function Bar() {
  return <span>World</span>;
}
          `,
        },
        // Export default is not a function
        {
          code: `
const value = 42;
export default value;
          `,
        },
        // Export default function returns non-JSX
        {
          code: `
export default function Demo() {
  return null;
}
          `,
        },
        // Function returns a string
        {
          code: `
export default function Demo() {
  return 'hello';
}
          `,
        },
        // Call-wrapped export with no function argument
        {
          code: `
export const theme = createTheme({ palette: { primary: 'red' } });
          `,
        },
      ],
      invalid: [
        // @highlight in a string literal should NOT cause skip
        {
          code: `export default function Demo() {
  return <Button label="@highlight this">Click</Button>;
}`,
          output: `export default function Demo() {
  // @focus
  return <Button label="@highlight this">Click</Button>;
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // @focus in a string literal should NOT cause skip
        {
          code: `export default function Demo() {
  return <Button label="@focus this">Click</Button>;
}`,
          output: `export default function Demo() {
  // @focus
  return <Button label="@focus this">Click</Button>;
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // @highlight comment alone should NOT cause skip — @focus is still needed
        {
          code: `// @highlight
export default function Demo() {
  return <Button>Click</Button>;
}`,
          output: `// @highlight
export default function Demo() {
  // @focus
  return <Button>Click</Button>;
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // Single JSX element (no wrapper), single line: // comment fix
        {
          code: `export default function Demo() {
  return <Button>Click me</Button>;
}`,
          output: `export default function Demo() {
  // @focus
  return <Button>Click me</Button>;
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // Wrapper div with multiple children: {/* start/end */} fix
        {
          code: `export default function Demo() {
  return (
    <div>
      <Button>Click me</Button>
      <Button>Click me too</Button>
    </div>
  );
}`,
          output: `export default function Demo() {
  return (
    <div>
      {/* @focus-start */}
      <Button>Click me</Button>
      <Button>Click me too</Button>
      {/* @focus-end */}
    </div>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsx' }],
        },
        // Wrapper Box with single child: {/* single */} fix
        {
          code: `export default function Demo() {
  return (
    <Box>
      <TextField label="Name" />
    </Box>
  );
}`,
          output: `export default function Demo() {
  return (
    <Box>
      {/* @focus */}
      <TextField label="Name" />
    </Box>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsxSingle' }],
        },
        // Wrapper Stack with multiple children: {/* start/end */} fix
        {
          code: `export default function Demo() {
  return (
    <Stack>
      <Input />
      <Button />
    </Stack>
  );
}`,
          output: `export default function Demo() {
  return (
    <Stack>
      {/* @focus-start */}
      <Input />
      <Button />
      {/* @focus-end */}
    </Stack>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsx' }],
        },
        // Fragment shorthand with single child: {/* single */} fix
        {
          code: `export default function Demo() {
  return (
    <>
      <Button>Click</Button>
    </>
  );
}`,
          output: `export default function Demo() {
  return (
    <>
      {/* @focus */}
      <Button>Click</Button>
    </>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsxSingle' }],
        },
        // Arrow function with block body returning bare element: // comment fix
        {
          code: `export default () => {
  return <Button>Click</Button>;
}`,
          output: `export default () => {
  // @focus
  return <Button>Click</Button>;
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // Arrow function with implicit return of bare element: // comment fix
        {
          code: `export default () => <Button>Click</Button>`,
          output: `// @focus\nexport default () => <Button>Click</Button>`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // Non-wrapper element inside parentheses: // comment fix
        {
          code: `export default function Demo() {
  return (
    <Button variant="contained">Submit</Button>
  );
}`,
          output: `export default function Demo() {
  return (
    // @focus
    <Button variant="contained">Submit</Button>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // Arrow function with wrapper div single child: {/* single */} fix
        {
          code: `export default () => {
  return (
    <div>
      <Button>Click</Button>
    </div>
  );
}`,
          output: `export default () => {
  return (
    <div>
      {/* @focus */}
      <Button>Click</Button>
    </div>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsxSingle' }],
        },
        // Named export function matching filename
        {
          filename: 'CodeEditor.tsx',
          code: `export function CodeEditor() {
  return (
    <div>
      <Input />
      <Button />
    </div>
  );
}`,
          output: `export function CodeEditor() {
  return (
    <div>
      {/* @focus-start */}
      <Input />
      <Button />
      {/* @focus-end */}
    </div>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsx' }],
        },
        // Named export const arrow matching filename
        {
          filename: 'MyDemo.tsx',
          code: `export const MyDemo = () => {
  return <Button>Click</Button>;
}`,
          output: `export const MyDemo = () => {
  // @focus
  return <Button>Click</Button>;
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // Single named export fallback (no filename match)
        {
          filename: 'Other.tsx',
          code: `export function Demo() {
  return <Button>Click</Button>;
}`,
          output: `export function Demo() {
  // @focus
  return <Button>Click</Button>;
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // Named export with filename match preferred over other exports
        {
          filename: 'Primary.tsx',
          code: `export function Helper() {
  return <span>helper</span>;
}
export function Primary() {
  return (
    <div>
      <Input />
      <Button />
    </div>
  );
}`,
          output: `export function Helper() {
  return <span>helper</span>;
}
export function Primary() {
  return (
    <div>
      {/* @focus-start */}
      <Input />
      <Button />
      {/* @focus-end */}
    </div>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsx' }],
        },
        // Function with hooks: highlight entire body
        {
          code: `export default function Demo() {
  const code = useCode();
  return (
    <div>
      {code.file}
    </div>
  );
}`,
          output: `export default function Demo() {
  // @focus-start
  const code = useCode();
  return (
    <div>
      {code.file}
    </div>
  );
  // @focus-end
}`,
          errors: [{ messageId: 'missingDemoFocusBody' }],
        },
        // Named export with hooks: highlight entire body
        {
          filename: 'CodeContent.tsx',
          code: `export function CodeContent(props) {
  const code = useCode(props);
  return (
    <div>{code.file}</div>
  );
}`,
          output: `export function CodeContent(props) {
  // @focus-start
  const code = useCode(props);
  return (
    <div>{code.file}</div>
  );
  // @focus-end
}`,
          errors: [{ messageId: 'missingDemoFocusBody' }],
        },
        // Call-wrapped named export: React.forwardRef with filename match
        {
          filename: 'DialogTrigger.tsx',
          code: `export const DialogTrigger = React.forwardRef(function DialogTrigger(props, ref) {
  const { disabled, children, ...other } = props;
  return (
    <button type="button" ref={ref} disabled={disabled} {...other}>
      {children}
    </button>
  );
});`,
          output: `export const DialogTrigger = React.forwardRef(function DialogTrigger(props, ref) {
  // @focus-start
  const { disabled, children, ...other } = props;
  return (
    <button type="button" ref={ref} disabled={disabled} {...other}>
      {children}
    </button>
  );
  // @focus-end
});`,
          errors: [{ messageId: 'missingDemoFocusBody' }],
        },
        // Call-wrapped named export: React.memo with arrow function
        {
          filename: 'MemoDemo.tsx',
          code: `export const MemoDemo = React.memo(() => {
  return <Button>Click</Button>;
});`,
          output: `export const MemoDemo = React.memo(() => {
  // @focus
  return <Button>Click</Button>;
});`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // Call-wrapped default export: export default React.forwardRef(...)
        {
          code: `export default React.forwardRef(function Demo(props, ref) {
  return <Button ref={ref}>Click</Button>;
});`,
          output: `export default React.forwardRef(function Demo(props, ref) {
  // @focus
  return <Button ref={ref}>Click</Button>;
});`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
      ],
    });
  });

  // eslint-disable-next-line vitest/expect-expect -- RuleTester uses its own assertion library
  it('should handle wrapReturn option', () => {
    ruleTester.run('require-demo-focus', lintJavascriptDemoFocus, {
      valid: [],
      invalid: [
        // wrapReturn: bare return single-line -> wrap in parens
        {
          options: [{ wrapReturn: true }],
          code: `export default function Demo() {
  return <Button>Click me</Button>;
}`,
          output: `export default function Demo() {
  return (
    // @focus
    <Button>Click me</Button>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // wrapReturn: already has parens, single-line -> just insert comment
        {
          options: [{ wrapReturn: true }],
          code: `export default function Demo() {
  return (
    <Checkbox defaultChecked />
  );
}`,
          output: `export default function Demo() {
  return (
    // @focus
    <Checkbox defaultChecked />
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
        // wrapReturn: bare return multi-line -> wrap in parens with start/end
        {
          options: [{ wrapReturn: true }],
          code: `export default function Demo() {
  return <Card>
    <Button>Click</Button>
  </Card>;
}`,
          output: `export default function Demo() {
  return (
    // @focus-start
    <Card>
    <Button>Click</Button>
  </Card>
    // @focus-end
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJs' }],
        },
        // wrapReturn: wrapper elements are unaffected (still use JSX comments)
        {
          options: [{ wrapReturn: true }],
          code: `export default function Demo() {
  return (
    <div>
      <Button>Click</Button>
    </div>
  );
}`,
          output: `export default function Demo() {
  return (
    <div>
      {/* @focus */}
      <Button>Click</Button>
    </div>
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsxSingle' }],
        },
        // wrapReturn: named export bare return
        {
          options: [{ wrapReturn: true }],
          filename: 'CheckboxRed.tsx',
          code: `export function CheckboxRed() {
  return <Checkbox defaultChecked />;
}`,
          output: `export function CheckboxRed() {
  return (
    // @focus
    <Checkbox defaultChecked />
  );
}`,
          errors: [{ messageId: 'missingDemoFocusJsSingle' }],
        },
      ],
    });
  });
});
