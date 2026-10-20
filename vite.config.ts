import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` keeps asset paths relative so the built app works from any
// sub-path (GitHub Pages, a shared drive, or opening dist/ on a local server).
export default defineConfig({
  plugins: [react()],
  base: "./",
  // /api goes to the Python backend (backend/) when it's running on :8000.
  server: { host: true, port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
});
