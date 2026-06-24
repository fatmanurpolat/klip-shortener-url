import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Built as a static SPA. `base: "./"` keeps asset URLs relative so the bundle
// can be served from a subpath behind nginx without rewrites.
export default defineConfig(({ mode }) => {
  // VITE_API_TARGET picks which backend the dev proxy forwards /api to:
  //   http://localhost       → the Docker stack via nginx (this is Mailpit-wired)
  //   http://localhost:3000  → a local `npm run dev` backend you run yourself
  // Set it in web/dashboard/.env.local. A real shell env var still wins (CI).
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = process.env.VITE_API_TARGET || env.VITE_API_TARGET || "http://localhost:3000";

  return {
    plugins: [react()],
    base: "./",
    resolve: {
      // Mirror the tsconfig "@/*" path alias for the bundler.
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 4100,
      // Proxy API calls to the Fastify app in dev so cookies are same-origin and
      // no CORS dance is needed (the magic-link session cookie is HttpOnly+Lax).
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
