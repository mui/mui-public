export type Rest<V> = [V, V];

export type Wrap<T> = { [K in keyof T]: [Extract<K, keyof T>, ...Rest<T[K]>] };

export type Result = Wrap<{ a: number; b: string }>;
