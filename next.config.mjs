/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Linting is not part of this project's build; type checking and tests are.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        // Chat replies can contain appointment details, so they must never be cached.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
