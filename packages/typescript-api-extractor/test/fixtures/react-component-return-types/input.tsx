import * as React from 'react';
import { type ReactElement, type ReactNode } from 'react';

// A component is recognized by the name of what it returns, in whichever form
// the author declared it.

export function NamespacedElement(props: { a?: string }): React.JSX.Element {
	return <div>{props.a}</div>;
}

export function BareElement(props: { a?: string }): ReactElement {
	return <div>{props.a}</div>;
}

export function GenericElement(props: { a?: string }): ReactElement<{ b: string }> {
	return <div>{props.a}</div>;
}

export function BareNode(props: { a?: string }): ReactNode {
	return <div>{props.a}</div>;
}

export function NullableElement(props: { a?: string }): React.JSX.Element | null {
	return props.a ? <div>{props.a}</div> : null;
}

export function InferredElement(props: { a?: string }) {
	return <div>{props.a}</div>;
}

interface ListElement {
	tag: string;
}

/**
 * A local type whose name merely ends in `Element` does not make a component.
 */
export function LocalElementType(props: { a?: string }): ListElement {
	return { tag: props.a ?? '' };
}

/**
 * Neither does a DOM element.
 */
export function DomElementType(props: { a?: string }): HTMLElement {
	return document.createElement(props.a ?? 'div');
}
