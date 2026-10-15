import { RuleTester } from '@typescript-eslint/rule-tester';
import parser from '@typescript-eslint/parser';
import rule from './no-constructor-assigned-field.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
  },
});

ruleTester.run('no-constructor-assigned-field', rule, {
  valid: [
    // Should pass: Field initialized at the declaration
    {
      code: `
class Manager {
  private items: string[] = [];
}
      `,
    },
    // Should pass: Declared field assigned in the constructor
    {
      code: `
class Manager {
  declare private items: string[];
  constructor() {
    this.items = [];
  }
}
      `,
    },
    // Should pass: Assigned in the constructor without a field
    {
      code: `
class Manager {
  constructor() {
    this.items = [];
  }
}
      `,
    },
    // Should pass: Static field with the same name
    {
      code: `
class Manager {
  static items: string[];
  constructor() {
    this.items = [];
  }
}
      `,
    },
    // Should pass: Private field can't be declared
    {
      code: `
class Manager {
  #items;
  constructor() {
    this.#items = [];
  }
}
      `,
    },
    // Should pass: Assigned inside a nested function in the constructor
    {
      code: `
class Manager {
  items: string[] = [];
  constructor(emitter) {
    emitter.on('reset', () => {
      this.items = [];
    });
    emitter.on('clear', function clear() {
      this.items = [];
    });
  }
}
      `,
    },
    // Should pass: Assigned in a regular method
    {
      code: `
class Manager {
  items: string[] = [];
  reset() {
    this.items = [];
  }
}
      `,
    },
    // Should pass: Abstract property
    {
      code: `
abstract class Manager {
  abstract items: string[];
  constructor() {
    this.items = [];
  }
}
      `,
    },
    // Should pass: Assigned in the constructor of a nested class
    {
      code: `
class Outer {
  items: string[] = [];
  constructor() {
    this.inner = class Inner {
      constructor() {
        this.items = [];
      }
    };
  }
}
      `,
    },
    // Should pass: Assigned in a field initializer of a nested class
    {
      code: `
class Outer {
  items: string[] = [];
  constructor() {
    this.inner = class Inner {
      accessor value = (this.items = []);
    };
  }
}
      `,
    },
    // Should pass: Reading the field in the constructor
    {
      code: `
class Manager {
  items: string[] = [];
  constructor() {
    this.items.push('a');
  }
}
      `,
    },
    // Should pass: Compound assignment reads the field rather than re-initializing it
    {
      code: `
class Counter {
  count = 0;
  constructor(start) {
    this.count += start;
  }
}
      `,
    },
    // Should pass: Conditional override of a default
    {
      code: `
class Manager {
  items: string[] = [];
  constructor(options) {
    if (options.items) {
      this.items = options.items;
    }
  }
}
      `,
    },
    // Should pass: Decorated field, which `declare` can't replace
    {
      code: `
class Manager {
  @observable protected items: string[];
  constructor() {
    this.items = [];
  }
}
      `,
    },
    // Should pass: Non-constant computed key
    {
      code: `
class Manager {
  items: string[];
  constructor(key) {
    this[key] = [];
  }
}
      `,
    },
    // Should pass: Assigned in a field initializer or static block of the same class
    {
      code: `
class Manager {
  items: string[];
  other = (this.items = []);
  static {
    this.items = [];
  }
  constructor() {}
}
      `,
    },
  ],
  invalid: [
    // Should fail: Typed fields without initializer assigned in the constructor
    {
      code: `
class Manager {
  private containers: string[];
  private items: string[];
  constructor() {
    this.items = [];
    this.containers = [];
  }
}
      `,
      errors: [
        {
          messageId: 'assignedInConstructor',
          data: { name: 'containers', declareHint: '' },
          suggestions: [
            {
              messageId: 'addDeclare',
              output: `
class Manager {
  declare private containers: string[];
  private items: string[];
  constructor() {
    this.items = [];
    this.containers = [];
  }
}
      `,
            },
          ],
        },
        {
          messageId: 'assignedInConstructor',
          data: { name: 'items', declareHint: '' },
          suggestions: [
            {
              messageId: 'addDeclare',
              output: `
class Manager {
  private containers: string[];
  declare private items: string[];
  constructor() {
    this.items = [];
    this.containers = [];
  }
}
      `,
            },
          ],
        },
      ],
    },
    // Should fail: Field with initializer overwritten unconditionally
    {
      code: `
class Manager {
  items: string[] = [];
  constructor(items) {
    this.items = items;
  }
}
      `,
      errors: [
        {
          messageId: 'assignedInConstructor',
          data: { name: 'items', declareHint: ' (drop its initializer)' },
          suggestions: [],
        },
      ],
    },
    // Should fail: Conditional assignment, without a suggestion as `declare` would hide TS2564
    {
      code: `
class Manager {
  readonly items: string[];
  constructor(items) {
    if (items) {
      this.items = items;
    }
  }
}
      `,
      errors: [{ messageId: 'assignedInConstructor', suggestions: [] }],
    },
    // Should fail: Conditional and unconditional assignment
    {
      code: `
class Manager {
  items: string[];
  constructor(items) {
    if (items) {
      this.items = items;
    }
    this.items = [];
  }
}
      `,
      errors: [
        {
          messageId: 'assignedInConstructor',
          suggestions: [
            {
              messageId: 'addDeclare',
              output: `
class Manager {
  declare items: string[];
  constructor(items) {
    if (items) {
      this.items = items;
    }
    this.items = [];
  }
}
      `,
            },
          ],
        },
      ],
    },
    // Should fail: Overriding field, which needs `override` dropped to be marked `declare`
    {
      code: `
class Manager extends Base {
  override items: string[];
  constructor() {
    super();
    this.items = [];
  }
}
      `,
      errors: [
        {
          messageId: 'assignedInConstructor',
          data: { name: 'items', declareHint: ' (drop `override`)' },
          suggestions: [],
        },
      ],
    },
    // Should fail: Definite assignment assertion, which needs `!` dropped to be marked `declare`
    {
      code: `
class Manager {
  private items!: string[];
  constructor() {
    this.items = [];
  }
}
      `,
      errors: [
        {
          messageId: 'assignedInConstructor',
          data: { name: 'items', declareHint: ' (drop the `!`)' },
          suggestions: [],
        },
      ],
    },
    // Should fail: Computed string key assignment
    {
      code: `
class Manager {
  items;
  constructor() {
    this['items'] = [];
  }
}
      `,
      errors: [
        {
          messageId: 'assignedInConstructor',
          suggestions: [
            {
              messageId: 'addDeclare',
              output: `
class Manager {
  declare items;
  constructor() {
    this['items'] = [];
  }
}
      `,
            },
          ],
        },
      ],
    },
    // Should fail: Assigned twice, reported once
    {
      code: `
class Manager {
  items: string[];
  constructor(items) {
    this.items = [];
    this.items = items;
  }
}
      `,
      errors: [
        {
          messageId: 'assignedInConstructor',
          suggestions: [
            {
              messageId: 'addDeclare',
              output: `
class Manager {
  declare items: string[];
  constructor(items) {
    this.items = [];
    this.items = items;
  }
}
      `,
            },
          ],
        },
      ],
    },
  ],
});
