/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NETLIFY ? 'export' : undefined,
  transpilePackages: ['@mui/internal-bundle-size-checker'],
};

export default nextConfig;
