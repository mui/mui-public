import * as React from "react";
import MuiCollapse from "@material-ui/core/Collapse";
import { useForkRef } from "@material-ui/core/utils";

/**
 * StrictMode compatible Material-UI collapse
 */
export function Collapse(props) {
	const { children, ...other } = props;
	const domRef = React.useRef(null);
	const ref = useForkRef(domRef, children.ref);

	return (
		<MuiCollapse
			{...other}
			findDOMNode={() => {
				// equivalent to ReactDOM.findDOMNode(this) in MuiCollapse
				// we're basically walking up till the outermost host node of MuiCollapse
				return domRef.current.parentElement.parentElement.parentElement;
			}}
		>
			{React.cloneElement(children, { ref })}
		</MuiCollapse>
	);
}
