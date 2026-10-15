import { defineConfig } from "vite";

// Relative base so the build works from any static host path (e.g. GitHub Pages).
export default defineConfig({
  base: "./",
  // Three.js alone is ~500 kB; the game ships as a single bundle.
  build: { chunkSizeWarningLimit: 800 },
});
