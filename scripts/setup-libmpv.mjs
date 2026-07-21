import { execSync } from "child_process";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const windowsResourcesDir = join(rootDir, "src-tauri", "resources", "windows");
const vcRedistPath = join(windowsResourcesDir, "vc_redist.x64.exe");
const vcRedistUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe";
const cliPaths = [
  join(rootDir, "node_modules", "tauri-plugin-libmpv-api", "dist-js", "cli.js"),
  join(
    rootDir,
    "node_modules",
    "tauri-plugin-libmpv-api",
    "dist-js",
    "cli.cjs",
  ),
];

for (const cliPath of cliPaths) {
  if (!existsSync(cliPath)) continue;

  const PINNED_MPV_TAG = "2026-07-06-c8c7d91a8e";
  const PINNED_URL = `https://github.com/zhongfly/mpv-winbuild/releases/download/${PINNED_MPV_TAG}`;

  let content = readFileSync(cliPath, "utf-8");
  const originalUrl =
    "https://github.com/zhongfly/mpv-winbuild/releases/latest/download";
  if (content.includes(originalUrl)) {
    content = content.replaceAll(originalUrl, PINNED_URL);
    writeFileSync(cliPath, content, "utf-8");
    console.log(
      `[setup-lib] Pinned mpv-winbuild to release: ${PINNED_MPV_TAG} in ${cliPath}`,
    );
  }
}

if (process.platform === "win32" && !existsSync(vcRedistPath)) {
  console.log(
    "[setup-lib] Downloading Microsoft Visual C++ Redistributable...",
  );
  mkdirSync(windowsResourcesDir, { recursive: true });
  const response = await fetch(vcRedistUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download Visual C++ Redistributable: ${response.status}`,
    );
  }
  writeFileSync(vcRedistPath, Buffer.from(await response.arrayBuffer()));
}

execSync("npx tauri-plugin-libmpv-api setup-lib", {
  stdio: "inherit",
  cwd: rootDir,
});
