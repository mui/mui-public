import { BaseExpression, Expression } from 'estree';

export * from 'estree';

declare module 'estree' {
  interface ExpressionMap {
    TSNonNullExpression: TSNonNullExpression;
    TSAsExpression: TSAsExpression;
  }
}

export interface TSNonNullExpression extends BaseExpression {
  type: 'TSNonNullExpression';
  expression: Expression;
}

export interface TSAsExpression extends BaseExpression {
  type: 'TSAsExpression';
  expression: Expression;
  typeAnnotation: Expression;
}
