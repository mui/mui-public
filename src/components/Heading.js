import Typography from "@material-ui/core/Typography";
import { makeStyles } from "@material-ui/core/styles";
import { Link } from "@material-ui/core";

const useStyles = makeStyles(
	{
		heading: {
			display: "inline-block",
		},
		link: {
			display: "inline-block",
			padding: 8,
			"& svg": {
				fill: "currentColor",
				width: "1em",
				height: ".8em",
			},
		},
	},
	{ name: "Heading" }
);

/**
 *
 * @param {object} props
 * @param {string} [props.id]
 * @param {string} props.level
 * @param {React.ReactNode} props.children
 */
export default function Heading(props) {
	const { children, id, level } = props;
	const classes = useStyles();

	return (
		<div>
			<Typography className={classes.heading} id={id} variant={`h${level}`}>
				{children}
			</Typography>
			{id !== undefined && (
				<Link
					aria-labelledby={id}
					className={classes.link}
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
