import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { prerenderPublicInformation } from "./tools/prerender-public-information";

export default defineConfig({
  plugins: [react(), prerenderPublicInformation()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3002"
    }
  }
});
