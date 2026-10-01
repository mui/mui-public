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
          data: { name: 'containers' },
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
          data: { name: 'items' },
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
    // Should fail: Field with initializer reassigned in the constructor
    {
      code: `
class Manager {
  items: string[] = [];
  constructor(items) {
    this.items = items;
  }
}
      `,
      errors: [{ messageId: 'assignedInConstructor', suggestions: [] }],
    },
    // Should fail: Conditional assignment in the constructor
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
      errors: [
        {
          messageId: 'assignedInConstructor',
          suggestions: [
            {
              messageId: 'addDeclare',
              output: `
class Manager {
  declare readonly items: string[];
  constructor(items) {
    if (items) {
      this.items = items;
    }
  }
}
      `,
            },
          ],
        },
      ],
    },
    // Should fail: Decorated field, which can't be marked `declare`
    {
      code: `
class Manager {
  @observable protected items: string[];
  constructor() {
    this.items = [];
  }
}
      `,
      errors: [{ messageId: 'assignedInConstructorNoDeclare', suggestions: [] }],
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
      errors: [{ messageId: 'assignedInConstructor', suggestions: [] }],
    },
    // Should fail: Definite assignment assertion, which can't be combined with `declare`
    {
      code: `
class Manager {
  private items!: string[];
  constructor() {
    this.items = [];
  }
}
      `,
      errors: [{ messageId: 'assignedInConstructor', suggestions: [] }],
    },
    // Should fail: Compound assignment
    {
      code: `
class Counter {
  count = 0;
  constructor(start) {
    this.count += start;
  }
}
      `,
      errors: [{ messageId: 'assignedInConstructorNoDeclare', suggestions: [] }],
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
      errors: [{ messageId: 'assignedInConstructorNoDeclare', suggestions: [] }],
    },
    // Should fail: Assigned once, reported once
    {
      code: `
class Manager {
  items;
  constructor(items) {
    this.items = [];
    this.items = items;
  }
}
      `,
      errors: [{ messageId: 'assignedInConstructorNoDeclare', suggestions: [] }],
    },
  ],
});
