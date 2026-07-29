import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The dev server proxies `/api` to the backend so local development runs
 * same-origin: no CORS preflights, and cookies behave exactly as they do in
 * production behind a single edge.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The shared laws-of-cricket fixtures live at the repo root and are read by
      // both engines' test suites.
      "@spec": fileURLToPath(new URL("../spec", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
        // Server-sent events must not be buffered by the proxy.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              delete proxyRes.headers["content-length"];
            }
          });
        },
      },
    },
  },
  build: {
    target: "es2022",
    // Maps are built for error reporting but not advertised in the bundle, so a
    // visitor cannot pull the whole source tree out of a production deployment.
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        // Keep the scoring console's first paint small: the vendor churn of
        // React/Query lives in its own long-cached chunk.
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
            },
            { name: "query", test: /node_modules[\\/]@tanstack[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "lcov"],
      include: ["src/lib/**"],
    },
  },
});
