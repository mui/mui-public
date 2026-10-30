/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@heroku/socksv5'],
  async redirects() {
    return [
      {
        // Render also serves production on its own hostname, which years of PR
        // comments link to. Send visitors to the canonical domain instead, but
        // leave /api alone: CI posts reports there, not every client re-sends a
        // POST body after a redirect, and the QR images in old comments load
        // from it. Previews have their own hostnames and never match.
        source: '/:path((?!api/).*)',
        has: [{ type: 'host', value: 'code-infra-dashboard\\.onrender\\.com' }],
        destination: 'https://frontend-public.mui.com/:path',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
