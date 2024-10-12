import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";

/**
 *
 * @param {object} props
 * @param {string} [props.id]
 * @param {string} props.level
 * @param {React.ReactNode} props.children
 */
export default function Heading(props) {
	const { children, id, level } = props;

	return (
		<div>
			<Typography id={id} variant={`h${level}`}>
				{children}
			</Typography>
			{id !== undefined && (
				<Link
					aria-labelledby={id}
					id={`${id}-fragment-link`}
					href={`#${id}`}
				>
					<svg>
						<use xlinkHref="#anchor-link-icon" />
					</svg>
				</Link>
			)}
		</div>
	);
}
