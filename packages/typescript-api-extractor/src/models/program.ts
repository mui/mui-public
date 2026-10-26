import { ModuleNode } from './module';

export class ProgramNode {
	constructor(public modules: ModuleNode[]) {}
}
