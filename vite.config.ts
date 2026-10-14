import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` keeps asset paths relative so the built app works from any
// sub-path (GitHub Pages, a shared drive, or opening dist/ on a local server).
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { host: true, port: 5173 },
});
