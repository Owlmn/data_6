/** @type {import('next').NextConfig} */
const nextConfig = {
  rewrites: async () => {
    return [
      // Только те пути, которые обрабатывает Python-функция.
      // /api/analyze — собственный Next.js роут (app/api/analyze/route.ts).
      {
        source: "/api/execute",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/execute"
            : "/api/",
      },
      {
        source: "/api/health",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/health"
            : "/api/",
      },
    ];
  },
};

module.exports = nextConfig
