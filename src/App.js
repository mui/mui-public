import React from "react";
import { createMuiTheme, ThemeProvider } from "@material-ui/core/styles";
import CssBaseline from "@material-ui/core/CssBaseline";
import * as colors from "@material-ui/core/colors";
import { ReactQueryConfigProvider } from "react-query";
import { Collapse } from "./components/transitions";

const Landing = React.lazy(() => import("./pages/Landing"));

function App() {
  const theme = React.useMemo(() => {
    const nextTheme = createMuiTheme({
      palette: {
        background: { default: "#121212" },
        primary: {
          main: colors.amber["300"]
        },
        secondary: {
          main: colors.teal["300"]
        },
        type: "dark"
      },
      props: {
        MuiButton: {
          size: "small"
        },
        MuiExpansionPanel: {
          TransitionComponent: Collapse
        },
        MuiFilledInput: {
          margin: "dense"
        },
        MuiFormControl: {
          margin: "dense"
        },
        MuiFormHelperText: {
          margin: "dense"
        },
        MuiIconButton: {
          size: "small"
        },
        MuiInputBase: {
          margin: "dense"
        },
        MuiInputLabel: {
          margin: "dense"
        },
        MuiListItem: {
          dense: true
        },
        MuiOutlinedInput: {
          margin: "dense"
        },
        MuiFab: {
          size: "small"
        },
        MuiTable: {
          size: "small"
        },
        MuiTextField: {
          margin: "dense"
        },
        MuiToolbar: {
          variant: "dense"
        }
      },
      overrides: {
        MuiIconButton: {
          sizeSmall: {
            // Adjust spacing to reach minimal touch target hitbox
            marginLeft: 4,
            marginRight: 4,
            padding: 12
          }
        }
      },
      spacing: 4,
      typography: {
        h1: {
          fontSize: "1.4rem"
        },
        h2: {
          fontSize: "1.2rem"
        },
        h3: {
          fontSize: "1.15rem"
        },
        h4: {
          fontSize: "1.1rem"
        },
        h5: {
          fontSize: "1.0rem"
        },
        h6: {
          fontSize: "1.0rem"
        }
      }
    });

    nextTheme.palette.background.level2 = "#333";
    nextTheme.palette.background.level1 = nextTheme.palette.grey[900];

    nextTheme.spacing = 4;

    return nextTheme;
  }, []);

  const queryConfig = React.useMemo(() => {
    return {
      suspense: true
    };
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ReactQueryConfigProvider config={queryConfig}>
        <React.Suspense fallback="landing">
          <Landing />
        </React.Suspense>
      </ReactQueryConfigProvider>
    </ThemeProvider>
  );
}

export default App;
