import ts from 'typescript';
import type { ScopedParserContext } from '../../parserContext';
import { EnumNode, EnumMember, IntrinsicNode, LiteralNode } from '../../models';
import type { AnyType } from '../../models';
import { getDocumentationFromSymbol } from '../documentationParser';
import { getTypeNamespaces } from '../common';
import { ParserError } from '../../ParserError';
import { TypeName } from '../../models/typeName';
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
  if (type.isLiteral()) {
    // A literal is the type of one member. It is also the type of an enum with a single
    // member, which TypeScript does not tell apart, so that case stays the whole enum.
    const memberSymbol = symbol;
    symbol = symbol?.parent;
    if (memberSymbol && symbol && session.context.checker.getExportsOfModule(symbol).length > 1) {
      return buildEnumMemberLiteral(type, memberSymbol, symbol, session.context);
    }
  }

  if (!symbol) {
    return new IntrinsicNode('any');
  }

  return buildEnumNodeFromSymbol(symbol, session.context);
}

/**
 * Represents the type of one enum member, such as `Side.left`, as a literal of the member's
 * value named after the member, so its value stays readable where the member is used.
 */
function buildEnumMemberLiteral(
  type: ts.LiteralType,
  memberSymbol: ts.Symbol,
  enumSymbol: ts.Symbol,
  context: ScopedParserContext,
): LiteralNode {
  const { checker } = context;
  const enumNamespaces = getTypeNamespaces(checker.getTypeOfSymbol(enumSymbol));

  return new LiteralNode(
    type.isStringLiteral() ? `"${type.value}"` : type.value,
    new TypeName(memberSymbol.getName(), [...enumNamespaces, enumSymbol.getName()]),
    getDocumentationFromSymbol(memberSymbol, checker),
  );
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
          memberType.isStringLiteral() || memberType.isNumberLiteral()
            ? memberType.value
            : undefined,
          getDocumentationFromSymbol(memberSymbol, checker),
        );
      });

      const symbolType = checker.getTypeOfSymbol(symbol);

      const namespaces = getTypeNamespaces(symbolType);

      return new EnumNode(
        new TypeName(symbol.getName(), namespaces.length > 0 ? namespaces : undefined),
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
