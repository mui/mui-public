import React from "react";
import { ServerStyleSheets as MuiServerStyleSheet } from "@material-ui/styles";
import { ServerStyleSheet as SCServerStyleSheet } from "styled-components";
import Document, { Html, Head, Main, NextScript } from "next/document";

export default class MyDocument extends Document {
	render() {
		return (
			<Html lang="en">
				<Head>
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<meta name="theme-color" content="#000000" />
					<meta
						name="description"
						content="Web site created using create-react-app"
					/>
					<link rel="apple-touch-icon" href="/logo192.png" />
					<link rel="manifest" href="/manifest.json" />
					{/*
            Preconnect allows the browser to setup early connections before an HTTP request
            is actually sent to the server.
            This includes DNS lookups, TLS negotiations, TCP handshakes.
          */}
					<link
						href="https://fonts.gstatic.com"
						rel="preconnect"
						crossOrigin="anonymous"
					/>
					<style id="material-icon-font" />
					<style id="insertion-point-jss" />
				</Head>
				<body>
					<Main />

					<NextScript />
				</body>
			</Html>
		);
	}
}

MyDocument.getInitialProps = async (ctx) => {
	// Resolution order
	//
	// On the server:
	// 1. page.getInitialProps
	// 2. document.getInitialProps
	// 3. page.render
	// 4. document.render
	//
	// On the server with error:
	// 2. document.getInitialProps
	// 3. page.render
	// 4. document.render
	//
	// On the client
	// 1. page.getInitialProps
	// 3. page.render

	// Render app and page and get the context of the page with collected side effects.
	const muiSheets = new MuiServerStyleSheet();
	const scSheets = new SCServerStyleSheet();
	const originalRenderPage = ctx.renderPage;

	ctx.renderPage = () =>
		originalRenderPage({
			enhanceApp: (App) => (props) =>
				scSheets.collectStyles(muiSheets.collect(<App {...props} />)),
		});

	const initialProps = await Document.getInitialProps(ctx);

	const muiCss = muiSheets.toString();

	return {
		...initialProps,
		styles: [
			...React.Children.toArray(initialProps.styles),
			<style
				id="mui-server-side"
				key="mui-server-side"
				// eslint-disable-next-line react/no-danger
				dangerouslySetInnerHTML={{ __html: muiCss }}
			/>,
			...scSheets.getStyleElement(),
		],
	};
};
