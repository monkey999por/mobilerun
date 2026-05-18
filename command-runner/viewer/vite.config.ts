import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 3102,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3101",
    },
    // WSL2 + Docker bind-mount だと inotify が container まで通らないため
    // HMR が走らない。500ms ポーリングに落とす。
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
});
