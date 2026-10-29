import type * as React from 'react';

export function inlineExport() {}

function overloadedFunction(a: number): number;
function overloadedFunction(a: string): string;
function overloadedFunction(a: number | string): number | string {
	return a;
}

const functionAndNamespaceDeclaration = function functionAndNamespaceDeclaration(
	params: functionAndNamespaceDeclaration.Params,
	ref: React.ForwardedRef<Element>,
) {
	return <div />;
};

namespace functionAndNamespaceDeclaration {
	export interface Params {
		a: number;
	}
}

export { overloadedFunction };

export { overloadedFunction as aliasedOverloadedFunction };

export { functionAndNamespaceDeclaration };

export default function defaultExport(a: number): number {
	return a;
}
