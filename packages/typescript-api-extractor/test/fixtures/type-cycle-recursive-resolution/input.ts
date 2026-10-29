export function recursiveObject(x: TestObject1<string>): void {}

export interface TestObject1<T> {
	obj2: TestObject2<T>;
}

export interface TestObject2<T> {
	obj1: TestObject1<string>;
}

// Test cyclic union - Union type referenced within its members
type UnionMember1 = { value: number; nestedUnion: Union };
type UnionMember2 = { value: string; nestedUnion: Union };
type Union = UnionMember1 | UnionMember2;
export function testUnion(x: Union): void {}

// Test cyclic intersection - Intersection type referenced within itself
type IntersectionBase = { id: number };
type IntersectionWithCycle = IntersectionBase & { self: IntersectionWithCycle };
export function testIntersection(x: IntersectionWithCycle): void {}

// Test cyclic array - Array type where the element type references the array
type ArrayElement = { value: number; parent: CyclicArray };
type CyclicArray = ArrayElement[];
export function testArray(x: CyclicArray): void {}

// Test cyclic tuple - Tuple type referenced within its elements
type TupleElement = { value: string; tuple: CyclicTuple };
type CyclicTuple = [TupleElement, number];
export function testTuple(x: CyclicTuple): void {}
