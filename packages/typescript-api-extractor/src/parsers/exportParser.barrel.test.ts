import { expect, it } from 'vitest';
import { parseFromProgram } from '../index';
import { createInMemoryProgram } from '../../test/support/inMemoryProgram';

interface SerializedType {
	value?: string;
	typeName?: {
		name: string;
	};
	types?: SerializedType[];
	properties?: SerializedProperty[];
}

interface SerializedProperty {
	name: string;
	type: SerializedType;
}

function getTriggerPressEventTypeNames(exportType: SerializedType): string[] {
	const triggerPressMember = exportType.types?.find((member) =>
		member.properties?.some(
			(property) => property.name === 'reason' && property.type.value === '"trigger-press"',
		),
	);
	const eventProperty = triggerPressMember?.properties?.find(
		(property) => property.name === 'event',
	);
	const eventTypes = eventProperty?.type.types;

	if (!eventTypes) {
		throw new Error('Missing trigger-press event union in the parsed export');
	}

	return eventTypes.map((type) => {
		if (!type.typeName) {
			throw new Error('Expected each event union member to be a named external type');
		}
		return type.typeName.name;
	});
}

it('preserves source union order when a barrel resolves namespaces before type exports', () => {
	const inputPath = '/virtual/index.ts';
	const program = createInMemoryProgram({
		[inputPath]: `export * as Component from './index.parts';
export type * from './root';
export { ComponentRoot as Root } from './root';`,
		'/virtual/index.parts.ts': "export { ComponentRoot as Root } from './root';",
		'/virtual/reasons.ts': `export const REASONS = {
  none: 'none',
  triggerPress: 'trigger-press',
} as const;`,
		'/virtual/details.ts': `import { REASONS } from './reasons';

interface ReasonToEventMap {
  [REASONS.triggerPress]: MouseEvent | PointerEvent | TouchEvent | KeyboardEvent;
  [REASONS.none]: Event;
}

export type ReasonToEvent<Reason extends string> = Reason extends keyof ReasonToEventMap
  ? ReasonToEventMap[Reason]
  : Event;

type BaseUIChangeEventDetail<Reason extends string> = {
  reason: Reason;
  event: ReasonToEvent<Reason>;
};

export type BaseUIChangeEventDetails<Reason extends string> =
  Reason extends string ? BaseUIChangeEventDetail<Reason> & {} : never;`,
		'/virtual/root.ts': `import { type BaseUIChangeEventDetails } from './details';
import { REASONS } from './reasons';

export function ComponentRoot(): void {}

export type ComponentRootChangeEventReason =
  | typeof REASONS.triggerPress
  | typeof REASONS.none;

export type ComponentRootChangeEventDetails =
  BaseUIChangeEventDetails<ComponentRoot.ChangeEventReason>;

export namespace ComponentRoot {
  export type ChangeEventReason = ComponentRootChangeEventReason;
  export type ChangeEventDetails = ComponentRootChangeEventDetails;
}`,
	});

	const moduleDefinition = parseFromProgram(inputPath, program);
	const serializedModuleDefinition = JSON.parse(JSON.stringify(moduleDefinition)) as {
		exports: Array<{ name: string; type: SerializedType }>;
	};
	const detailsExport = serializedModuleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'ComponentRootChangeEventDetails',
	);
	if (!detailsExport) {
		throw new Error('Expected ComponentRootChangeEventDetails export to be present');
	}

	// The barrel export resolves `Component.Root.ChangeEventDetails` before the
	// top-level type-only export. This pins the authored union order so descriptor
	// normalization cannot perturb TypeScript's lazy type cache.
	expect(getTriggerPressEventTypeNames(detailsExport.type)).toEqual([
		'MouseEvent',
		'PointerEvent',
		'TouchEvent',
		'KeyboardEvent',
	]);
});
