import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "frontend",
  base: "./",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../.react-build",
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
  },
});
