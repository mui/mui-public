/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@heroku/socksv5'],
  async redirects() {
    return [
      {
        // Render also serves production on its own hostname, which years of PR
        // comments link to. Send everything there to the canonical domain. This
        // includes /api: QR images in old comments still load, as their signature
        // doesn't depend on the host and GitHub's image proxy follows the 308.
        // Previews have their own hostnames and never match.
        source: '/:path*',
        has: [{ type: 'host', value: 'code-infra-dashboard\\.onrender\\.com' }],
        destination: 'https://frontend-public.mui.com/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
