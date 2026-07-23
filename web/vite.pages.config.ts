import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "static-site",
  base: "/music_to_midi/",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../..",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: "site-assets/app.js",
        chunkFileNames: "site-assets/[name].js",
        assetFileNames: "site-assets/[name][extname]",
      },
    },
  },
});
