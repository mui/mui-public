export class Repository<T extends object> {
	find<K extends keyof T>(key: K, value: T[K]): T | undefined {
		return undefined;
	}

	transform<U>(fn: (item: T) => U): U[] {
		return [];
	}

	merge<Other extends object>(other: Repository<Other>): Repository<T & Other> {
		return undefined as any;
	}
}
