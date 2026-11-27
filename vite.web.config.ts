import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./web/", import.meta.url)),
  base: "/music-video-maker/",
  build: { outDir: "../dist-web", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
