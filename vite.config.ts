import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const host = env.FRONTEND_HOST || "0.0.0.0";
  const port = Number(env.FRONTEND_PORT || 3100);

  return {
    base: "./",
    plugins: [react()],
    server: {
      host,
      port,
      strictPort: true
    },
    preview: {
      host,
      port,
      strictPort: true
    },
    build: {
      outDir: "dist",
      emptyOutDir: true
    }
  };
});
