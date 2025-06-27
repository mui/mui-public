import { RuleTester as EslintRuleTester } from 'eslint';
import { RuleTester as TypescriptEslintRuleTester } from '@typescript-eslint/rule-tester';
import { describe, it, afterAll } from 'vitest';

EslintRuleTester.describe = describe;
EslintRuleTester.it = it;
EslintRuleTester.itOnly = it.only;

TypescriptEslintRuleTester.afterAll = afterAll;
TypescriptEslintRuleTester.describe = describe;
TypescriptEslintRuleTester.describeSkip = describe.skip;
TypescriptEslintRuleTester.it = it;
TypescriptEslintRuleTester.itSkip = it.skip;
TypescriptEslintRuleTester.itOnly = it.only;
