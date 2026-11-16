import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../../", "");
  return {
    publicDir: "../web/public",
    plugins: [
      react(),
      {
        name: "spark-clerk-key",
        transformIndexHtml(html) {
          return html.replace(
            "__CLERK_PUBLISHABLE_KEY__",
            env.CLERK_PUBLISHABLE_KEY ?? "",
          );
        },
      },
    ],
    define: {
      __CLERK_PUBLISHABLE_KEY__: JSON.stringify(
        env.CLERK_PUBLISHABLE_KEY ?? "",
      ),
    },
    server: {
      proxy: {
        "/uploads": "http://127.0.0.1:4010",
        "/api": {
          target: "http://127.0.0.1:4010",
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
