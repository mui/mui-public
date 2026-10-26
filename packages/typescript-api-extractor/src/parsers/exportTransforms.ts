import { ExportNode } from '../models';
import { ParserContext } from '../parser';
import { transformComponentExport } from './componentParser';

type ExportTransform = (node: ExportNode, context: ParserContext) => ExportNode;

const exportTransforms: ExportTransform[] = [transformComponentExport];

/**
 * Runs each registered post-export transform over every node, in order. Transforms
 * reshape already-built generic export nodes (e.g. a function into a React component).
 */
export function applyExportTransforms(nodes: ExportNode[], context: ParserContext): ExportNode[] {
	return nodes.map((node) =>
		exportTransforms.reduce(
			(transformedNode, transform) => transform(transformedNode, context),
			node,
		),
	);
}
