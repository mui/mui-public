export class Documentation {
	constructor(
		public description: string | undefined,
		public defaultValue: unknown | undefined = undefined,
		public visibility: Visibility | undefined = undefined,
		public tags: DocumentationTag[] = [],
	) {}

	hasTag(name: string): boolean {
		return this.tags.some((tag) => tag.name === name);
	}

	getTagValue(name: string): string | undefined {
		return this.tags.find((tag) => tag.name === name)?.value;
	}
}

export interface DocumentationTag {
	name: string;
	value: string | undefined;
}

export type Visibility = 'public' | 'private' | 'internal';
