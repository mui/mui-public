import React from "react";
import { createMuiTheme, ThemeProvider } from "@material-ui/core/styles";
import CssBaseline from "@material-ui/core/CssBaseline";
import * as colors from "@material-ui/core/colors";
import { ReactQueryConfigProvider } from "react-query";
import { Collapse } from "./components/transitions";
import "./index.css";

const Landing = React.lazy(() => import("./pages/Landing"));
const ForkRibbon = React.lazy(() => import("./components/ForkRibbon.js"));

function App() {
	const theme = React.useMemo(() => {
		const nextTheme = createMuiTheme({
			palette: {
				background: { default: "#121212" },
				primary: {
					main: colors.amber["300"],
				},
				secondary: {
					main: colors.teal["300"],
				},
				type: "dark",
			},
			props: {
				MuiButton: {
					size: "small",
				},
				MuiExpansionPanel: {
					TransitionComponent: Collapse,
				},
				MuiFilledInput: {
					margin: "dense",
				},
				MuiFormControl: {
					margin: "dense",
				},
				MuiFormHelperText: {
					margin: "dense",
				},
				MuiIconButton: {
					size: "small",
				},
				MuiInputBase: {
					margin: "dense",
				},
				MuiInputLabel: {
					margin: "dense",
				},
				MuiListItem: {
					dense: true,
				},
				MuiOutlinedInput: {
					margin: "dense",
				},
				MuiFab: {
					size: "small",
				},
				MuiTable: {
					size: "small",
				},
				MuiTextField: {
					margin: "dense",
				},
				MuiToolbar: {
					variant: "dense",
				},
			},
			overrides: {
				MuiIconButton: {
					sizeSmall: {
						// Adjust spacing to reach minimal touch target hitbox
						marginLeft: 4,
						marginRight: 4,
						padding: 12,
					},
				},
			},
			spacing: 4,
			typography: {
				h1: {
					fontSize: "1.4rem",
				},
				h2: {
					fontSize: "1.2rem",
				},
				h3: {
					fontSize: "1.15rem",
				},
				h4: {
					fontSize: "1.1rem",
				},
				h5: {
					fontSize: "1.0rem",
				},
				h6: {
					fontSize: "1.0rem",
				},
			},
		});

		nextTheme.palette.background.level2 = "#333";
		nextTheme.palette.background.level1 = nextTheme.palette.grey[900];

		nextTheme.spacing = 4;

		return nextTheme;
	}, []);

	const queryConfig = React.useMemo(() => {
		return {
			suspense: true,
		};
	}, []);

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<ReactQueryConfigProvider config={queryConfig}>
				<svg style={{ display: "none" }} xmlns="http://www.w3.org/2000/svg">
					<symbol id="anchor-link-icon" viewBox="0 0 16 16">
						<path d="M4 9h1v1H4c-1.5 0-3-1.69-3-3.5S2.55 3 4 3h4c1.45 0 3 1.69 3 3.5 0 1.41-.91 2.72-2 3.25V8.59c.58-.45 1-1.27 1-2.09C10 5.22 8.98 4 8 4H4c-.98 0-2 1.22-2 2.5S3 9 4 9zm9-3h-1v1h1c1 0 2 1.22 2 2.5S13.98 12 13 12H9c-.98 0-2-1.22-2-2.5 0-.83.42-1.64 1-2.09V6.25c-1.09.53-2 1.84-2 3.25C6 11.31 7.55 13 9 13h4c1.45 0 3-1.69 3-3.5S14.5 6 13 6z" />
					</symbol>
				</svg>
				<React.Suspense fallback="landing">
					<ForkRibbon />
					<Landing />
				</React.Suspense>
			</ReactQueryConfigProvider>
		</ThemeProvider>
	);
}

export default App;
