const {
	addAfterLoader,
	removeLoaders,
	loaderByName,
	getLoaders,
	throwUnexpectedConfigError
} = require("@craco/craco");
const chalk = require("chalk");
const log = console.log;
const { ESBuildMinifyPlugin } = require("esbuild-loader");

const throwError = (message) =>
	throwUnexpectedConfigError({
		packageName: "craco",
		githubRepo: "gsoft-inc/craco",
		message,
		githubIssueQuery: "webpack"
	});

module.exports = {
	style: {
		postcss: {
			plugins: [require("tailwindcss"), require("autoprefixer")]
		}
	},
	webpack: {
		configure: (webpackConfig, { paths }) => {

			const { hasFoundAny, matches } = getLoaders(
				webpackConfig,
				loaderByName("babel-loader")
			);
			if (!hasFoundAny) throwError("failed to find babel-loader");

			log(chalk.green("removing babel-loader"));
			const { hasRemovedAny, removedCount } = removeLoaders(
				webpackConfig,
				loaderByName("babel-loader")
			);
			if (!hasRemovedAny) throwError("no babel-loader to remove");
			if (removedCount !== 2)
				throwError("had expected to remove 2 babel loader instances");

			log(chalk.green("adding esbuild-loader"));

			const tsLoader = {
				test: /\.(js|mjs|jsx|ts|tsx)$/,
				include: paths.appSrc,
				loader: require.resolve("esbuild-loader"),
				options: {
					loader: "tsx",
					target: "es2015"
				}
			};

			const { isAdded: tsLoaderIsAdded } = addAfterLoader(
				webpackConfig,
				loaderByName("url-loader"),
				tsLoader
			);
			if (!tsLoaderIsAdded) throwError("failed to add esbuild-loader");
			log(chalk.green("added esbuild-loader"));

			log(chalk.green("adding non-application JS babel-loader back"));
			const { isAdded: babelLoaderIsAdded } = addAfterLoader(
				webpackConfig,
				loaderByName("esbuild-loader"),
				matches[1].loader // babel-loader
			);
			if (!babelLoaderIsAdded)
				throwError("failed to add back babel-loader for non-application JS");
			log(chalk.green("added non-application JS babel-loader back"));

			log(chalk.green("replacing TerserPlugin with ESBuildMinifyPlugin"));
			webpackConfig.optimization.minimizer = [
				new ESBuildMinifyPlugin({
					target: "es2019"
				})
			];

			return webpackConfig;
		}
	}
};
