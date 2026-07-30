import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  // The harvested townsquare art is served at the web root: /icons/imp.png etc.
  publicDir: fileURLToPath(new URL("../../assets", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: true, // phones on the LAN need to reach the dev server
    proxy: {
      "/socket.io": {
        target: "http://localhost:3111",
        ws: true,
      },
      "/api": { target: "http://localhost:3111" },
      "/user-assets": { target: "http://localhost:3111" },
    },
  },
});
