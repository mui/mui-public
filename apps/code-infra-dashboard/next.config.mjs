/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@mui/internal-bundle-size-checker'],
  serverExternalPackages: ['@heroku/socksv5'],
};

export default nextConfig;
