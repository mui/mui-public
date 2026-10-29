export interface Manager<Data extends object = any> {
	add: <T extends Data = Data>(options: Options<T>) => string;
	update: <T extends Data = Data>(id: string, updates: Options<T>) => void;
	process: <Value, T extends Data = Data>(
		value: Promise<Value>,
		options: Options<T>,
	) => Promise<Value>;
}

interface Options<T> {
	data?: T;
}
