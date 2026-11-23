import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {libmediaChunkPlugin} from "@vega/libmedia-engine/assets";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
import {createHash} from 'node:crypto';
import {legacyWebosPlugin} from './scripts/legacy-webos.mjs';
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
  const legacyWebos = mode === 'webos-legacy';
  const tizen = mode === 'tizen';
  const tvHost = mode === 'webos' || legacyWebos ? 'webos' : mode === 'amazon-vega' || tizen ? mode : '';
  const webBuild = mode === "web" || !!tvHost;
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
    base: tvHost ? './' : '/',
    plugins: [react(), tailwindcss(), libmediaChunkPlugin(), ...(legacyWebos ? [legacyWebosPlugin()] : (tvHost==='webos' || tizen) ? [legacyWebosPlugin({chrome:tizen ? 108 : 94,lowerSandbox:false})] : []), {
      name:'production-script-policy', apply:'build',
      transformIndexHtml: {order:'post', handler(html) {
        const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
          .filter(match => !/\bsrc\s*=/.test(match[1])).map(match => `'sha256-${createHash('sha256').update(match[2].replace(/\r\n?/g,'\n')).digest('base64')}'`);
        // Libmedia's worker bootstrap imports generated blob scripts. worker-src
        // permits creating the worker; script-src also governs its imports.
        // User-approved exception for the packaged webOS app: Chromium 94
        // predates wasm-unsafe-eval and requires unsafe-eval to compile WASM.
        // Browser, desktop and Amazon builds retain the WASM-only permission.
        const wasmPermission = tvHost === 'webos' ? "'unsafe-eval'" : "'wasm-unsafe-eval'";
        const policy = ["default-src 'self'", `script-src 'self' ${wasmPermission} blob: ${hashes.join(' ')}`,
          "style-src 'self' 'unsafe-inline'", "connect-src 'self' https: http: wss: blob: data: ipc: asset: tauri:",
          "img-src 'self' https: http: data: blob: asset:", "media-src 'self' https: http: blob: data: asset:",
          "font-src 'self' data:", "worker-src 'self' blob:", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
        return [{tag:'meta', attrs:{'http-equiv':'Content-Security-Policy', content:policy}, injectTo:'head-prepend'}];
      }},
    }],
    optimizeDeps: {exclude:["@libmedia/avplayer"], include:['quickjs-emscripten', '@jitl/quickjs-singlefile-browser-release-sync', '@jitl/quickjs-wasmfile-release-sync', 'ipaddr.js']},
    define: {
      'import.meta.env.VITE_LEGACY_WEBOS': JSON.stringify(legacyWebos),
      'import.meta.env.VITE_WEBOS_COMPAT': JSON.stringify(tvHost==='webos'),
      'import.meta.env.VITE_TV_HOST': JSON.stringify(tvHost),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version),
      ...(webBuild ? {'import.meta.env.VITE_TV_MODE': JSON.stringify(tvHost ? 'true' : 'false')} : {}),
      "import.meta.env.VITE_TMDB_API_KEY": JSON.stringify(tmdbApiKey),
      "import.meta.env.VITE_PROXY_API_URL": JSON.stringify(proxyApiUrl),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: webBuild ? 5173 : 1420,
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
    build: {
      outDir: legacyWebos ? 'dist-tv/webos-legacy/ui' : tvHost ? `dist-tv/${tvHost}/ui` : webBuild ? "dist-web" : "dist",
      target:
        legacyWebos ? 'chrome68' : tvHost==='webos' ? 'chrome94' : tizen ? 'chrome108' : webBuild ? "es2022" : process.env.TAURI_ENV_PLATFORM === "windows"
          ? "chrome105"
          : "safari13",
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
    ...(legacyWebos ? {worker:{format:'iife' as const}} : {}),
  };
});
