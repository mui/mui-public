import * as React from 'react';

export function CallbackPropsComponent(props: Props): React.ReactElement {
	return <div />;
}

interface Props {
	onChange: (event: React.ChangeEvent<HTMLInputElement>, reason: string | undefined) => void;
	onClosing: OnClosingCallback;
	onOpen: OnOpenCallback;
	onClosed?: () => void;
}

type OnClosingCallback = (animated: boolean) => boolean;

interface OnOpenCallback {
	(animated: boolean): void;
}
