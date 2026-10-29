/*
 The output of this test isn't ideal now.
 We're disregarding the extra properties of the callable type and treating it as a function.
*/

import * as React from 'react';

interface Callable {
	(param: number): number;
}

interface ExtraData {
	data?: string;
}

const testFunction: Callable & ExtraData = function testFunctionDeclaration() {
	return 1;
};

testFunction.data = 'test';

export { testFunction as test };

interface Props {
	value: string;
}

const TestComponent: React.FC<Props> & ExtraData = (props) => {
	return <div />;
};

TestComponent.data = 'test';

export { TestComponent };
