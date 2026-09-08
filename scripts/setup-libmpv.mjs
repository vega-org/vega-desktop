import { execSync } from "child_process";
import { existsSync, writeFileSync, readFileSync, mkdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const windowsResourcesDir = join(rootDir, "src-tauri", "resources", "windows");
const vcRedistPath = join(windowsResourcesDir, "vc_redist.x64.exe");
const vcRedistUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe";
const libDir = join(rootDir, "src-tauri", "lib");

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

async function resolveMpvBaseUrl() {
  try {
    const res = await fetch(
      "https://github.com/zhongfly/mpv-winbuild/releases/latest/download/sha256.txt",
    );
    if (res.ok) {
      const text = await res.text();
      if (
        text.includes("mpv-dev-lgpl-x86_64") &&
        text
          .split("\n")
          .some((l) => l.includes("mpv-dev-lgpl-x86_64") && !l.includes("v3"))
      ) {
        return "https://github.com/zhongfly/mpv-winbuild/releases/latest/download";
      }
    }
  } catch (e) {
    console.warn("[setup-lib] Could not query latest sha256.txt:", e.message);
  }

  try {
    const res = await fetch(
      "https://api.github.com/repos/zhongfly/mpv-winbuild/releases?per_page=10",
      {
        headers: { "User-Agent": "vega-desktop-builder" },
      },
    );
    if (res.ok) {
      const releases = await res.json();
      for (const rel of releases) {
        const hasAsset = rel.assets?.some(
          (a) =>
            a.name.includes("mpv-dev-lgpl-x86_64") && !a.name.includes("v3"),
        );
        if (hasAsset) {
          console.log(
            `[setup-lib] Found mpv-winbuild release tag: ${rel.tag_name}`,
          );
          return `https://github.com/zhongfly/mpv-winbuild/releases/download/${rel.tag_name}`;
        }
      }
    }
  } catch (e) {
    console.warn("[setup-lib] Could not query releases API:", e.message);
  }

  return "https://github.com/zhongfly/mpv-winbuild/releases/latest/download";
}

const isWindows = process.platform === "win32";
const hasWindowsDlls = () => {
  const dllPath = join(libDir, "libmpv-2.dll");
  const wrapperPath = join(libDir, "libmpv-wrapper.dll");
  return (
    existsSync(dllPath) &&
    statSync(dllPath).size > 1024 * 1024 &&
    existsSync(wrapperPath) &&
    statSync(wrapperPath).size > 1024
  );
};

if (isWindows && !existsSync(vcRedistPath)) {
  console.log(
    "[setup-lib] Downloading Microsoft Visual C++ Redistributable...",
  );
  mkdirSync(windowsResourcesDir, { recursive: true });
  try {
    const response = await fetch(vcRedistUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download Visual C++ Redistributable: ${response.status}`,
      );
    }
    writeFileSync(vcRedistPath, Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.warn(
      "[setup-lib] Warning: could not download vc_redist.x64.exe:",
      err.message,
    );
  }
}

if (isWindows && hasWindowsDlls()) {
  console.log(
    "[setup-lib] Verified libmpv-2.dll and libmpv-wrapper.dll already exist in src-tauri/lib. Skipping download.",
  );
  process.exit(0);
}

const mpvUrl = await resolveMpvBaseUrl();

for (const cliPath of cliPaths) {
  if (!existsSync(cliPath)) continue;

  let content = readFileSync(cliPath, "utf-8");
  const mpvBaseUrlPattern =
    /const MPV_BASE_URL = ["']https:\/\/github\.com\/zhongfly\/mpv-winbuild\/releases\/(?:latest\/download|download\/[^"']+)["'];/;
  const patchedBaseUrl = `const MPV_BASE_URL = "${mpvUrl}";`;
  if (mpvBaseUrlPattern.test(content)) {
    content = content.replace(mpvBaseUrlPattern, patchedBaseUrl);
    writeFileSync(cliPath, content, "utf-8");
    console.log(
      `[setup-lib] Pinned mpv-winbuild to URL: ${mpvUrl} in ${cliPath}`,
    );
  }
}

try {
  execSync("npx tauri-plugin-libmpv-api setup-lib", {
    stdio: "inherit",
    cwd: rootDir,
  });
} catch (err) {
  if (isWindows && hasWindowsDlls()) {
    console.log(
      "[setup-lib] setup-lib had a network warning, but valid libmpv libraries are already present in src-tauri/lib. Continuing build.",
    );
  } else {
    throw err;
  }
}
