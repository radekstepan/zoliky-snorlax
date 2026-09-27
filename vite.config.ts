import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // Dev-only: no auto-reload on window focus / file save.
  // `yarn dev` keeps serving, but never pushes HMR or full-reload to the
  // browser — reload manually (Cmd+R) when you want the new code.
  // `hmr: false` stops hot updates, `ws: false` stops the dev websocket
  // (which can itself trigger reloads on disconnect), `watch: null`
  // disables file watching so background writes (coverage/, editor
  // autosave, …) can't nuke the in-memory game state.
  // This block is ignored by `vite build` / `vite preview`.
  server: {
    hmr: false,
    ws: false,
    watch: null,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
