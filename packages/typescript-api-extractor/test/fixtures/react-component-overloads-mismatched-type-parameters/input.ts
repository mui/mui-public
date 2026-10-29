import type * as React from 'react';

export function DifferentNamesComponent<Value>(props: { value: Value }): React.ReactNode;
export function DifferentNamesComponent<Item>(props: { items: Item[] }): React.ReactNode;
export function DifferentNamesComponent(props: { value?: unknown; items?: unknown[] }) {
	return null;
}

export function DifferentConstraintsComponent<Value extends string>(props: {
	value: Value;
}): React.ReactNode;
export function DifferentConstraintsComponent<Value extends number>(props: {
	value: Value;
}): React.ReactNode;
export function DifferentConstraintsComponent(props: { value: string | number }) {
	return null;
}

export function PartiallyGenericComponent<Value>(props: { value: Value }): React.ReactNode;
export function PartiallyGenericComponent(props: { label: string }): React.ReactNode;
export function PartiallyGenericComponent(props: { value?: unknown; label?: string }) {
	return null;
}

export function DifferentDefaultsComponent<Value = string>(props: {
	value?: Value;
}): React.ReactNode;
export function DifferentDefaultsComponent<Value = number>(props: {
	value?: Value;
}): React.ReactNode;
export function DifferentDefaultsComponent(props: { value?: unknown }) {
	return null;
}

export function NestedGenericConstraintsComponent<
	Value extends { format: <Input extends string>(input: Input) => string },
>(props: { value: Value }): React.ReactNode;
export function NestedGenericConstraintsComponent<
	Value extends { format: <Input extends number>(input: Input) => string },
>(props: { value: Value }): React.ReactNode;
export function NestedGenericConstraintsComponent(props: { value: unknown }) {
	return null;
}
