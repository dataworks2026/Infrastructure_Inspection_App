const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  compress: true,
  swcMinify: true,

  // Skip TS type errors during production build (types are checked in dev/CI)
  typescript: { ignoreBuildErrors: true },
  eslint:     { ignoreDuringBuilds: true },

  async rewrites() {
    return [
      { source: '/api/:path*',     destination: 'http://localhost:8000/api/:path*' },
      { source: '/storage/:path*', destination: 'http://localhost:8000/storage/:path*' },
    ]
  },

  // ── Turbopack config (used when running `next dev --turbo`) ──────────────
  experimental: {
    turbo: {
      resolveAlias: {
        // Turbopack chokes on Leaflet's legacy IE filter CSS syntax.
        // Point the import to an empty stub — the real CSS is loaded via CDN.
        'leaflet/dist/leaflet.css': path.resolve(__dirname, './leaflet-stub.css'),
      },
    },
  },

  // ── Webpack config (used for `next build` / production) ──────────────────
  webpack(config) {
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        ...config.optimization?.splitChunks,
        cacheGroups: {
          ...(config.optimization?.splitChunks?.cacheGroups || {}),
          leaflet: {
            test: /[\\/]node_modules[\\/](leaflet|react-leaflet)[\\/]/,
            name: 'leaflet',
            chunks: 'async',
            priority: 20,
          },
          recharts: {
            test: /[\\/]node_modules[\\/](recharts|d3-[a-z-]+)[\\/]/,
            name: 'recharts',
            chunks: 'async',
            priority: 20,
          },
        },
      },
    };
    return config;
  },
}

module.exports = nextConfig
