export function DeclaredComponent(props: Props) {
	return <div {...props} />;
}

interface Props {
	className?: string;
}
