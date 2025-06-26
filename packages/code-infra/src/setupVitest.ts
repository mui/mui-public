import { RuleTester as EslintRuleTester } from 'eslint';
import { RuleTester as typescriptEslintRuleTester } from '@typescript-eslint/rule-tester';
import { describe, it, afterAll } from 'vitest';

EslintRuleTester.describe = describe;
EslintRuleTester.it = it;
EslintRuleTester.itOnly = it.only;

typescriptEslintRuleTester.afterAll = afterAll;
typescriptEslintRuleTester.describe = describe;
typescriptEslintRuleTester.describeSkip = describe.skip;
typescriptEslintRuleTester.it = it;
typescriptEslintRuleTester.itSkip = it.skip;
typescriptEslintRuleTester.itOnly = it.only;
