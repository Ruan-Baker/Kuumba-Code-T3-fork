import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    tanstackRouter({ routesDirectory: "src/routes" }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    include: ["@huggingface/transformers"],
  },
  server: {
    port: 5734,
    strictPort: true,
  },
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
  },
});
