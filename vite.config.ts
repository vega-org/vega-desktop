import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

const getSharedMobileTmdbKey = () => {
  try {
    const contents = readFileSync(`${process.cwd()}/../vega-mobile/.env`, "utf8");
    const match = contents.match(/^\s*TMDB_API_KEY\s*=\s*(.+?)\s*$/m);
    return match?.[1]?.replace(/^['"]|['"]$/g, "").trim() || "";
  } catch {
    return "";
  }
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const desktopEnv = loadEnv(mode, process.cwd(), "");
  const tmdbApiKey =
    desktopEnv.TMDB_API_KEY ||
    desktopEnv.VITE_TMDB_API_KEY ||
    getSharedMobileTmdbKey() ||
    "";

  const proxyApiUrl =
    desktopEnv.PROXY_API_URL ||
    desktopEnv.VITE_PROXY_API_URL ||
    desktopEnv.META_PROXY_URL ||
    desktopEnv.VITE_META_PROXY_URL ||
    "";

  return {
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_TMDB_API_KEY": JSON.stringify(tmdbApiKey),
      "import.meta.env.VITE_PROXY_API_URL": JSON.stringify(proxyApiUrl),
    },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
    server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    },
  };
});
