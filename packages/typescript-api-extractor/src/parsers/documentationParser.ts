import ts from 'typescript';
import { Documentation, DocumentationTag } from '../models';

/**
 * Reads documentation for a symbol, preferring its first declaration's JSDoc and
 * falling back to the checker's resolved documentation comment (e.g. for symbols
 * whose own declarations are not directly annotated).
 */
export function getDocumentationFromSymbol(
	symbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): Documentation | undefined {
	if (!symbol) {
		return undefined;
	}

	const decl = symbol.getDeclarations();
	if (decl) {
		return getDocumentationFromNode(decl[0]);
	}

	const comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
	return comment ? new Documentation(comment) : undefined;
}

/**
 * Extracts the description, `@default`, visibility, and remaining custom tags from
 * a node's JSDoc. Only a single JSDoc block is consumed; `@param` and visibility
 * tags are handled elsewhere and excluded from the generic tag list.
 */
export function getDocumentationFromNode(node: ts.Node): Documentation | undefined {
	const comments = ts.getJSDocCommentsAndTags(node);
	if (comments && comments.length === 1) {
		const commentNode = comments[0];
		if (ts.isJSDoc(commentNode)) {
			const tags = commentNode.tags
				?.filter(
					(tag) =>
						!['default', 'private', 'internal', 'public', 'param'].includes(tag.tagName.text),
				)
				.map(parseTag);

			return new Documentation(
				commentNode.comment as string | undefined,
				commentNode.tags?.find((t) => t.tagName.text === 'default')?.comment,
				getVisibilityFromJSDoc(commentNode),
				tags ?? [],
			);
		}
	}
}

/**
 * Builds documentation that belongs to a single parameter. Handles `@param`
 * summaries while preserving extra tags like `@public` or `@internal` as
 * parameter metadata rather than copying the parent function documentation.
 */
export function getParameterDocumentationFromSymbol(
	parameterSymbol: ts.Symbol,
	checker: ts.TypeChecker,
): Documentation | undefined {
	const summary = parameterSymbol
		.getDocumentationComment(checker)
		.map((comment) => comment.text)
		.join('\n')
		.replace(/^[\s-*:]*/, '');

	const rawTags = parameterSymbol.getJsDocTags(checker);
	const docTags: DocumentationTag[] = rawTags
		.filter((tag) => tag.name !== 'param')
		.map((tag) => {
			const text = tag.text?.map((part) => part.text).join(' ');
			return {
				name: tag.name,
				value: text,
			};
		});
	const visibility = getVisibilityFromTagNames(rawTags.map((tag) => tag.name));

	if (!summary.length && docTags.length === 0) {
		return undefined;
	}

	// Keep an empty description for tag-only parameter docs. Existing snapshots
	// expose that shape for function parameters, so the shared parser preserves
	// it instead of silently changing serialized API output.
	return new Documentation(summary, undefined, visibility, docTags);
}

function getVisibilityFromJSDoc(doc: ts.JSDoc): Documentation['visibility'] | undefined {
	return getVisibilityFromTagNames(doc.tags?.map((tag) => tag.tagName.text) ?? []);
}

function getVisibilityFromTagNames(
	tagNames: Iterable<string>,
): Documentation['visibility'] | undefined {
	const tags = new Set(tagNames);

	if (tags.has('private')) {
		return 'private';
	}

	if (tags.has('internal')) {
		return 'internal';
	}

	if (tags.has('public')) {
		return 'public';
	}

	return undefined;
}

function parseTag(tag: ts.JSDocTag): DocumentationTag {
	if (ts.isJSDocTypeTag(tag)) {
		return {
			name: tag.tagName.text,
			value: tag.typeExpression?.type.getText(),
		};
	}

	return {
		name: tag.tagName.text,
		value: typeof tag.comment === 'string' ? tag.comment : undefined,
	};
}
