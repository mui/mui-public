import * as React from 'react';

// Polymorphic components pick their implementation at module scope, so their
// exported type is a union of component types rather than a single one. Each arm
// describes the same component under a different prop form, and the extractor
// should report one merged prop table instead of a bare union.

declare const supportsRender: boolean;

interface ToolbarProps {
	children?: React.ReactNode;
	/**
	 * Class applied to the root element.
	 */
	className?: string;
}

interface RenderToolbarProps {
	/**
	 * Renders the root element itself.
	 */
	render: (props: { className?: string }) => React.ReactElement;
	className?: string;
}

const ToolbarRoot = React.forwardRef(function Toolbar(
	props: ToolbarProps,
	ref: React.Ref<HTMLDivElement>,
) {
	return <div ref={ref}>{props.children}</div>;
});

const ToolbarWithRender = React.forwardRef(function Toolbar(
	props: RenderToolbarProps,
	ref: React.Ref<HTMLDivElement>,
) {
	return <div ref={ref}>{props.render({ className: props.className })}</div>;
});

/**
 * A toolbar that renders either its own root element or a caller-supplied one.
 */
export const Toolbar = supportsRender ? ToolbarWithRender : ToolbarRoot;

/**
 * Not every union of a component is a component: an arm that is not itself
 * component-like keeps the export a plain union.
 */
export const OptionalToolbar = supportsRender ? ToolbarRoot : undefined;
