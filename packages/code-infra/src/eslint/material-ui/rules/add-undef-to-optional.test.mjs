import { afterAll, it, describe } from 'vitest';
import { RuleTester } from '@typescript-eslint/rule-tester';
import TSESlintParser from '@typescript-eslint/parser';
import rule from './add-undef-to-optional.mjs';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: TSESlintParser,
  },
});

ruleTester.run('add-undef-to-optional', rule, {
  valid: [
    {
      name: 'optional property with undefined',
      code: `
    export type Hello = {
      name?: string | undefined;
    };
        `,
    },
    {
      name: 'optional property with undefined in union',
      code: `
    export type Hello = {
      name?: (string | number) | undefined;
    };
        `,
    },
    {
      name: 'optional property with undefined and type reference',
      code: `
    type NameArg = string | number;
    export type Hello = {
      name?: NameArg | undefined;
    };
        `,
    },
    {
      name: 'optional property with type reference including undefined',
      code: `
    type NameArg = string | number | undefined;
    export type Hello = {
      name?: NameArg;
    };
        `,
    },
    {
      name: 'optional property with built-in type reference and explicit undefined',
      code: `
    export type Hello = {
      data?: Record<string, string> | undefined;
    };
        `,
    },
    {
      name: 'optional property with generic type reference and explicit undefined',
      code: `
    export type Hello<T> = {
      value?: T | undefined;
    };
        `,
    },
    {
      name: 'required property without undefined',
      code: `
    export type Hello = {
      name: string | number;
    };
        `,
    },
    {
      name: 'optional property with null and undefined',
      code: `
    export type Hello = {
      name?: string | null | undefined;
    };
        `,
    },
    {
      name: 'optional property with complex union including undefined',
      code: `
    export type Hello = {
      name?: (string | number | boolean) | undefined;
    };
        `,
    },
    {
      name: 'optional property with nested type reference including undefined',
      code: `
    type Inner = string | undefined;
    type Outer = Inner | number;
    export type Hello = {
      name?: Outer;
    };
        `,
    },
    {
      name: 'optional property with type reference in interface',
      code: `
    type NameArg = string | undefined;
    export interface Hello {
      name?: NameArg;
    }
        `,
    },
    {
      name: 'multiple optional properties with mixed scenarios',
      code: `
    type WithUndef = string | undefined;
    type WithoutUndef = string | number;
    export type Hello = {
      a?: WithUndef;
      b?: WithoutUndef | undefined;
      c?: string | undefined;
    };
        `,
    },
    {
      name: 'optional property with any type',
      code: `
    export type Hello = {
      value?: any;
    };
        `,
    },
    {
      name: 'optional property with unknown type',
      code: `
    export type Hello = {
      value?: unknown;
    };
        `,
    },
    {
      name: 'optional property with any in union',
      code: `
    export type Hello = {
      value?: string | any;
    };
        `,
    },
    {
      name: 'optional property with unknown in union',
      code: `
    export type Hello = {
      value?: string | unknown;
    };
        `,
    },
    {
      name: 'optional property with type reference to any',
      code: `
    type AnyType = any;
    export type Hello = {
      value?: AnyType;
    };
        `,
    },
    {
      name: 'optional property with type reference to unknown',
      code: `
    type UnknownType = unknown;
    export type Hello = {
      value?: UnknownType;
    };
        `,
    },
    {
      name: 'optional property with ReactNode',
      code: `
    import { ReactNode } from 'react';
    export type Hello = {
      children?: ReactNode;
    };
        `,
    },
    {
      name: 'optional property with React.ReactNode',
      code: `
    import React from 'react';
    export type Hello = {
      children?: React.ReactNode;
    };
        `,
    },
    {
      name: 'optional property with ReactNode without import',
      code: `
    export type Hello = {
      content?: ReactNode;
    };
        `,
    },
    {
      name: 'optional property with React.ReactNode in union',
      code: `
    import React from 'react';
    export type Hello = {
      value?: string | React.ReactNode;
    };
        `,
    },
  ],
  invalid: [
    {
      name: 'optional property without undefined',
      code: `export type Hello = {
  name?: string | number;
};
    `,
      errors: [{ messageId: 'addUndefined', line: 2, column: 3 }],
      output: `export type Hello = {
  name?: (string | number) | undefined;
};
    `,
    },
    {
      name: 'optional property with simple type',
      code: `export type Hello = {
  name?: string;
};
      `,
      errors: [{ messageId: 'addUndefined', line: 2, column: 3 }],
      output: `export type Hello = {
  name?: (string) | undefined;
};
      `,
    },
    {
      name: 'optional property with local type reference without undefined',
      code: `type NameArg = string | number;
export type Hello = {
  name?: NameArg;
};
      `,
      errors: [{ messageId: 'addUndefined', line: 3, column: 3 }],
      output: `type NameArg = string | number;
export type Hello = {
  name?: (NameArg) | undefined;
};
      `,
    },
    {
      name: 'optional property in interface without undefined',
      code: `export interface Hello {
  name?: string;
}
      `,
      errors: [{ messageId: 'addUndefined', line: 2, column: 3 }],
      output: `export interface Hello {
  name?: (string) | undefined;
}
      `,
    },
    {
      name: 'multiple optional properties missing undefined',
      code: `export type Hello = {
  name?: string;
  age?: number;
};
      `,
      errors: [
        { messageId: 'addUndefined', line: 2, column: 3 },
        { messageId: 'addUndefined', line: 3, column: 3 },
      ],
      output: `export type Hello = {
  name?: (string) | undefined;
  age?: (number) | undefined;
};
      `,
    },
    {
      name: 'optional property with union but no undefined',
      code: `export type Hello = {
  value?: string | number | boolean;
};
      `,
      errors: [{ messageId: 'addUndefined', line: 2, column: 3 }],
      output: `export type Hello = {
  value?: (string | number | boolean) | undefined;
};
      `,
    },
    {
      name: 'optional property with nested type reference without undefined',
      code: `type Inner = string | number;
type Outer = Inner | boolean;
export type Hello = {
  value?: Outer;
};
      `,
      errors: [{ messageId: 'addUndefined', line: 4, column: 3 }],
      output: `type Inner = string | number;
type Outer = Inner | boolean;
export type Hello = {
  value?: (Outer) | undefined;
};
      `,
    },
    {
      name: 'optional property with null but no undefined',
      code: `export type Hello = {
  value?: string | null;
};
      `,
      errors: [{ messageId: 'addUndefined', line: 2, column: 3 }],
      output: `export type Hello = {
  value?: (string | null) | undefined;
};
      `,
    },
    {
      name: 'optional property with imported type reference',
      code: `import { SomeType } from './other';
export type Hello = {
  name?: SomeType;
};
      `,
      errors: [{ messageId: 'addUndefined', line: 3, column: 3 }],
      output: `import { SomeType } from './other';
export type Hello = {
  name?: (SomeType) | undefined;
};
      `,
    },
    {
      name: 'optional property with built-in type reference',
      code: `export type Hello = {
  data?: Record<string, string>;
};
      `,
      errors: [{ messageId: 'addUndefined', line: 2, column: 3 }],
      output: `export type Hello = {
  data?: (Record<string, string>) | undefined;
};
      `,
    },
    {
      name: 'optional property with generic type parameter',
      code: `export type Hello<T> = {
  value?: T;
};
      `,
      errors: [{ messageId: 'addUndefined', line: 2, column: 3 }],
      output: `export type Hello<T> = {
  value?: (T) | undefined;
};
      `,
    },
    {
      name: 'optional property with function type without undefined',
      code: `export type Hello = {
  onPressedChange?: (pressed: boolean, eventDetails: Toggle.ChangeEventDetails) => void;
}`,
      errors: [{ messageId: 'addUndefined', line: 2, column: 3 }],
      output: `export type Hello = {
  onPressedChange?: ((pressed: boolean, eventDetails: Toggle.ChangeEventDetails) => void) | undefined;
}`,
    },
  ],
});
