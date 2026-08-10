import { fileURLToPath, URL } from "node:url";

import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Dev server proxies `/api` to the backend (same-origin).
 * HTTPS is on so phones on the LAN can install the PWA home-screen icon.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@spec": fileURLToPath(new URL("../spec", import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
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
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: "hidden",
    rollupOptions: {
      output: {
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
