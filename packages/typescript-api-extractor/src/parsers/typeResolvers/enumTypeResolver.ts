import ts from 'typescript';
import type { ScopedParserContext } from '../../parserContext';
import { EnumNode, EnumMember, IntrinsicNode } from '../../models';
import type { AnyType } from '../../models';
import { getDocumentationFromSymbol } from '../documentationParser';
import { createTypeName, getTypeNamespaces } from '../common';
import { ParserError } from '../../ParserError';
import type { TypeResolutionRequest, TypeResolutionSession } from '../typeResolutionTypes';
import { includesCompositeFlag } from '../typeResolutionUtils';

// Enum-like flag detection and EnumNode construction live together
// so single-member enum edge cases and symbol/member extraction stay in one place.

export function resolveEnumLikeType(
  { type }: TypeResolutionRequest,
  session: TypeResolutionSession,
): AnyType | undefined {
  if (!includesCompositeFlag(type, ts.TypeFlags.EnumLike)) {
    return undefined;
  }

  let symbol = type.aliasSymbol ?? type.getSymbol();
  if ('value' in type) {
    // Edge case: when an enum has one member only, type.getSymbol() returns the symbol of the member.
    symbol = symbol?.parent;
  }

  if (!symbol) {
    return new IntrinsicNode('any');
  }

  return buildEnumNodeFromSymbol(symbol, session.context);
}

function buildEnumNodeFromSymbol(symbol: ts.Symbol, context: ScopedParserContext): EnumNode {
  const { checker } = context;

  return context.runWithSymbolScope(symbol.name, () => {
    try {
      const memberSymbols = checker.getExportsOfModule(symbol);
      const members = memberSymbols.map((memberSymbol) => {
        if (!memberSymbol) {
          throw new Error('Could not find symbol for member');
        }

        const memberType = checker.getTypeOfSymbol(memberSymbol);

        return new EnumMember(
          memberSymbol.getName(),
          (memberType as any).value,
          getDocumentationFromSymbol(memberSymbol, checker),
        );
      });

      const symbolType = checker.getTypeOfSymbol(symbol);

      const namespaces = getTypeNamespaces(symbolType);

      return new EnumNode(
        createTypeName(
          symbol,
          context,
          symbol.getName(),
          namespaces.length > 0 ? namespaces : undefined,
        ),
        members,
        getDocumentationFromSymbol(symbol, checker),
      );
    } catch (error) {
      if (!(error instanceof ParserError)) {
        throw new ParserError(error, context.parsedSymbolStack);
      }

      throw error;
    }
  });
}
