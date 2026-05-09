/** @type {import('next').NextConfig} */
const nextConfig = {
  rewrites: async () => {
    return [
      {
        source: "/api/execute",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/execute"
            : "/api/execute",
      },
      {
        source: "/api/health",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/health"
            : "/api/health",
      },
    ];
  },
};

module.exports = nextConfig
