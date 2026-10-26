export interface Interface1 {
	s: string;
}

interface Interface2 {
	n: number;
}

export type { Interface2 };
export type { Interface2 as Interface2Alias };

export interface Interface1 {
	b: boolean;
}

export default interface DefaultInterface {
	n1: number;
	n2?: number;
}
