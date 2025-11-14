import { describe, it, expect } from 'vitest';
import ts from 'typescript';

// eslint-disable-next-line import/extensions
import { transformSourceFile } from './tsAddExplicitUndefined.mjs';

/**
 * Transform source code string by adding explicit undefined to optional properties.
 */
export function transformSourceCode(sourceCode: string, fileName = 'test.ts'): string {
  const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, true);

  // Create a minimal program for the single file to get a type checker
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
  });
  const program = ts.createProgram(
    [fileName],
    {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      allowJs: false,
      skipLibCheck: true,
      skipDefaultLibCheck: true,
    },
    {
      getSourceFile: (name) => (name === fileName ? sourceFile : undefined),
      writeFile: () => {},
      getCurrentDirectory: () => '',
      getDirectories: () => [],
      fileExists: () => true,
      readFile: () => '',
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      getDefaultLibFileName: () => 'lib.d.ts',
    },
  );

  const checker = program.getTypeChecker();
  return transformSourceFile(sourceFile, checker, printer);
}

describe('transformSourceCode', () => {
  describe('basic optional properties', () => {
    it('should add undefined to simple optional property', () => {
      const input = `interface Foo {
  bar?: string;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('bar?: string | undefined;');
    });

    it('should add undefined to multiple optional properties', () => {
      const input = `interface Foo {
  bar?: string;
  baz?: number;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('bar?: string | undefined;');
      expect(output).toContain('baz?: number | undefined;');
    });

    it('should not modify properties that already have undefined', () => {
      const input = `interface Foo {
  bar?: string | undefined;
}`;
      const output = transformSourceCode(input);
      // The transformation should preserve the undefined type
      expect(output).toContain('bar?: string | undefined;');
      // Should not add another undefined
      expect(output).not.toContain('bar?: string | undefined | undefined;');
    });

    it('should not modify required properties', () => {
      const input = `interface Foo {
  bar: string;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('bar: string;');
      expect(output).not.toContain('bar?: string');
    });
  });

  describe('union types', () => {
    it('should add undefined to optional property with union type', () => {
      const input = `interface Foo {
  bar?: string | number;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('bar?: string | number | undefined;');
    });

    it('should not add undefined if union already includes it', () => {
      const input = `interface Foo {
  bar?: string | number | undefined;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('bar?: string | number | undefined;');
      // Should not add duplicate undefined
      expect(output).not.toContain('bar?: string | number | undefined | undefined;');
    });

    it('should handle null in union types', () => {
      const input = `interface Foo {
  bar?: string | null;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('bar?: string | null | undefined;');
    });
  });

  describe('complex types', () => {
    it('should handle optional properties with function types', () => {
      const input = `interface Foo {
  onClick?: (event: MouseEvent) => void;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('onClick?: ((event: MouseEvent) => void) | undefined;');
    });

    it('should handle optional properties with array types', () => {
      const input = `interface Foo {
  items?: string[];
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('items?: string[] | undefined;');
    });

    it('should handle optional properties with object types', () => {
      const input = `interface Foo {
  config?: { enabled: boolean };
}`;
      const output = transformSourceCode(input);
      // The printer may format this differently, so just check that undefined was added
      expect(output).toContain('config?:');
      expect(output).toContain('| undefined');
      expect(output).toContain('enabled: boolean');
    });

    it('should handle optional properties with generic types', () => {
      const input = `interface Foo<T> {
  value?: T;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('value?: T | undefined;');
    });
  });

  describe('type aliases', () => {
    it('should handle optional properties in type aliases', () => {
      const input = `type Foo = {
  bar?: string;
};`;
      const output = transformSourceCode(input);
      expect(output).toContain('bar?: string | undefined;');
    });
  });

  describe('class properties', () => {
    it('should handle optional class properties', () => {
      const input = `class Foo {
  bar?: string;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('bar?: string | undefined;');
    });

    it('should handle optional class properties with initializers', () => {
      const input = `class Foo {
  bar?: string = 'default';
}`;
      const output = transformSourceCode(input);
      expect(output).toContain("bar?: string | undefined = 'default';");
    });
  });

  describe('parenthesized types', () => {
    it('should handle parenthesized types', () => {
      const input = `interface Foo {
  bar?: (string | number);
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('bar?: (string | number) | undefined;');
    });
  });

  describe('nested interfaces', () => {
    it('should handle top-level optional properties with nested object types', () => {
      const input = `interface Outer {
  inner?: {
    value?: string;
  };
}`;
      const output = transformSourceCode(input);
      // The outer property should get undefined added
      expect(output).toContain('inner?:');
      expect(output).toContain('| undefined');
      // Note: nested properties inside object literal types are not transformed
      // This is expected behavior - the transformation only handles interface/type properties
    });
  });

  describe('edge cases', () => {
    it('should handle empty interfaces', () => {
      const input = `interface Foo {}`;
      const output = transformSourceCode(input);
      expect(output).toContain('interface Foo');
    });

    it('should handle interfaces with only required properties', () => {
      const input = `interface Foo {
    bar: string;
    baz: number;
}
`;
      const output = transformSourceCode(input);
      expect(output).toBe(input);
    });

    it('should handle mixed required and optional properties', () => {
      const input = `interface Foo {
  required: string;
  optional?: number;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('required: string;');
      expect(output).toContain('optional?: number | undefined;');
    });

    it('should preserve comments', () => {
      const input = `interface Foo {
  /**
   * This is a comment
   */
  bar?: string;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('This is a comment');
      expect(output).toContain('bar?: string | undefined;');
    });

    it('should handle readonly optional properties', () => {
      const input = `interface Foo {
  readonly bar?: string;
}`;
      const output = transformSourceCode(input);
      expect(output).toContain('readonly bar?: string | undefined;');
    });
  });

  describe('literal undefined', () => {
    it('should detect literal undefined in union', () => {
      const input = `interface Foo {
    bar?: undefined;
}
`;
      const output = transformSourceCode(input);
      expect(output).toBe(input);
    });
  });

  describe('pre-existing undefined', () => {
    it('should not add undefined to pre-existing unions containing undefined', () => {
      const input = `type Test = string | undefined;
interface Foo {
    bar?: Test;
}
`;
      const output = transformSourceCode(input);
      expect(output).toBe(input);
    });
  });
});
