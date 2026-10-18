import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the page runs on Vite (5173) and /api goes to the Docs Co
// backend (8080). In production the backend serves the built page itself.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
