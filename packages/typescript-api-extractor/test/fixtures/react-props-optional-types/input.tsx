import * as React from 'react';

export function OptionalPropsComponent(props: Props): React.ReactElement {
	return <div>{props.requiredString}</div>;
}

interface Props {
	requiredString: string;
	optionalString?: string;
	stringOrUndefined: string | undefined;
	requiredBoolean: boolean;
	optionalBoolean?: boolean;
}
