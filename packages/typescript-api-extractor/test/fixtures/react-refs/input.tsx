import * as React from 'react';

export function RefPropsComponent(props: Props) {
	return <div />;
}

interface Props {
	refObject: React.RefObject<HTMLInputElement>;
	refCallback: React.RefCallback<HTMLInputElement>;
	ref: React.Ref<HTMLInputElement>;
	optionalRefObject?: React.RefObject<HTMLInputElement>;
	optionalRefCallback?: React.RefCallback<HTMLInputElement>;
	optionalRef?: React.Ref<HTMLInputElement>;
}
