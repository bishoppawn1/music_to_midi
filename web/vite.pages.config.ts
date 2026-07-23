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
        entryFileNames: "site-assets/app-[hash].js",
        chunkFileNames: "site-assets/[name]-[hash].js",
        assetFileNames: "site-assets/[name]-[hash][extname]",
      },
    },
  },
});
