/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@heroku/socksv5'],
  experimental: {
    // The TS7 side-by-side alias (@typescript/typescript6) ships no `tsc` bin,
    // which the Next.js >= 16.3 CLI checker requires. Use the TS6 JS API.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
