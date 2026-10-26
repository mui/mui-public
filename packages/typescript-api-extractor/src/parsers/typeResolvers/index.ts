import { type TypeResolver } from '../typeResolutionTypes';
import { resolveArrayType } from './arrayTypeResolver';
import { resolveAuthoredKeyofAlias } from './authoredTypeAlias';
import { resolveClassType } from './classTypeResolver';
import { resolveEnumLikeType } from './enumTypeResolver';
import { resolveCallableType } from './functionTypeResolver';
import { resolveIntrinsicType } from './intrinsicTypeResolver';
import { resolveIntersectionType } from './intersectionTypeResolver';
import { resolveLiteralType } from './literalTypeResolver';
import { resolveObjectLikeType } from './objectTypeResolver';
import {
	resolveConditionalType,
	resolveExtractUtilityType,
	resolveIndexLikeType,
	resolveTypeParameterType,
} from './specialTypeResolvers';
import { resolveExternalType } from './externalTypeResolver';
import { resolveTemplateLiteralType } from './templateLiteralTypeResolver';
import { resolveTupleType } from './tupleTypeResolver';
import { resolveTypeOperatorType } from './typeOperatorTypeResolver';
import { resolveUnionTypeNode } from './unionTypeResolver';

/**
 * Ordered type-resolution strategies, from authored/specific shapes to broad fallbacks.
 *
 * The order is observable: TypeScript frequently exposes `keyof`, arrays,
 * callables, and classes as object-like semantic types. Keeping the registry
 * explicit prevents a broad resolver from silently consuming a shape before
 * its syntax-aware resolver can preserve public output.
 */
export const typeResolvers: TypeResolver[] = [
	{
		name: 'authored-keyof-alias',
		replaysAuthoredSyntax: true,
		resolve: resolveAuthoredKeyofAlias,
	},
	{ name: 'type-operator', replaysAuthoredSyntax: true, resolve: resolveTypeOperatorType },
	{ name: 'external', resolve: resolveExternalType },
	{ name: 'type-parameter', resolve: resolveTypeParameterType },
	{ name: 'array', replaysAuthoredSyntax: true, resolve: resolveArrayType },
	{ name: 'intrinsic', resolve: resolveIntrinsicType },
	{ name: 'enum', resolve: resolveEnumLikeType },
	{ name: 'union', resolve: resolveUnionTypeNode },
	{ name: 'intersection', resolve: resolveIntersectionType },
	{ name: 'tuple', replaysAuthoredSyntax: true, resolve: resolveTupleType },
	{ name: 'literal', resolve: resolveLiteralType },
	{ name: 'template-literal', resolve: resolveTemplateLiteralType },
	{ name: 'callable', resolve: resolveCallableType },
	{ name: 'class', resolve: resolveClassType },
	{ name: 'object', resolve: resolveObjectLikeType },
	{
		name: 'extract-utility',
		replayNameResolutionWarnings: false,
		resolve: resolveExtractUtilityType,
	},
	{
		name: 'conditional',
		replayNameResolutionWarnings: false,
		resolve: resolveConditionalType,
	},
	{ name: 'index-like', replayNameResolutionWarnings: false, resolve: resolveIndexLikeType },
];
