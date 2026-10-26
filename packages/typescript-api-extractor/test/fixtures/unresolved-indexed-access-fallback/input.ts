type Lookup<T, K extends keyof T> = T[K];

export type IndexedAccessFallback = <T, K extends keyof T>(value: Lookup<T, K>) => void;
