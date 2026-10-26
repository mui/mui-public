export type StringKeys<T> = Extract<keyof T, string>;

export type StringValues<T, K extends keyof T> = Extract<T[K], string>;

export type KeepStrings<T extends string> = Extract<T, string>;
