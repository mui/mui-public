import * as React from 'react';

// React.forwardRef makes props an intersection of the provided props and RefAttributes.
// In this case, it's a union of intersections.

export const Button = React.forwardRef(function Button(
	props: ButtonProps,
	forwardedRef: React.ForwardedRef<HTMLButtonElement>,
) {
	const { nativeButton = true, ...other } = props;
	return <button ref={forwardedRef} {...other} />;
});

type ButtonProps = ButtonNativeProps | ButtonNonNativeProps;

interface ButtonNativeProps extends HTMLButtonProps {
	nativeButton?: true;
}

interface ButtonNonNativeProps extends HTMLButtonProps {
	nativeButton: false;
}

interface HTMLButtonProps {
	type?: 'button' | 'submit' | 'reset';
	id?: string;
	className?: string;
}
