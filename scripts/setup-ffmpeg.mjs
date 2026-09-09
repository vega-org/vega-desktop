import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const releaseTag = "b6.1.1";
const releaseBase =
  `https://github.com/eugeneware/ffmpeg-static/releases/download/${releaseTag}`;
const root = join(fileURLToPath(new URL("..", import.meta.url)));
const destination = join(root, "src-tauri", "resources", "ffmpeg-sidecar");
const executableSuffix = platform() === "win32" ? ".exe" : "";

function verifyBinary(path, tool) {
  const result = spawnSync(path, ["-version"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${tool} verification failed: ${result.error?.message ?? result.stderr ?? "unknown error"}`,
    );
  }
}

async function downloadAsset(name, output) {
  console.log(`Downloading ${name}...`);
  const response = await fetch(`${releaseBase}/${name}`, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${name} download failed: HTTP ${response.status}`);
  }
  writeFileSync(output, Buffer.from(await response.arrayBuffer()));
  if (platform() !== "win32") chmodSync(output, 0o755);
}

function platformAssetName(tool, cpu = arch()) {
  if (platform() === "win32") {
    if (cpu !== "x64") throw new Error(`Unsupported Windows architecture: ${cpu}`);
    return `${tool}-win32-x64`;
  }

  if (platform() === "linux") {
    const linuxCpu = { x64: "x64", arm64: "arm64", arm: "arm", ia32: "ia32" }[cpu];
    if (!linuxCpu) throw new Error(`Unsupported Linux architecture: ${cpu}`);
    return `${tool}-linux-${linuxCpu}`;
  }

  if (platform() === "darwin") {
    if (cpu !== "x64" && cpu !== "arm64") {
      throw new Error(`Unsupported macOS architecture: ${cpu}`);
    }
    return `${tool}-darwin-${cpu}`;
  }

  throw new Error(`Unsupported release platform: ${platform()}`);
}

const ffmpegOut = join(destination, `ffmpeg${executableSuffix}`);
const ffprobeOut = join(destination, `ffprobe${executableSuffix}`);
if (existsSync(ffmpegOut) && existsSync(ffprobeOut)) {
  try {
    verifyBinary(ffmpegOut, "ffmpeg");
    verifyBinary(ffprobeOut, "ffprobe");
    console.log(
      `Native FFmpeg and FFprobe sidecars already verified for ${platform()}/${arch()}.`,
    );
    process.exit(0);
  } catch {
    // Re-download if existing files failed verification
  }
}

const temporary = mkdtempSync(join(tmpdir(), "vega-ffmpeg-"));

try {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  for (const tool of ["ffmpeg", "ffprobe"]) {
    const output = join(destination, `${tool}${executableSuffix}`);

    if (platform() === "darwin") {
      const intel = join(temporary, `${tool}-x64`);
      const appleSilicon = join(temporary, `${tool}-arm64`);
      await downloadAsset(platformAssetName(tool, "x64"), intel);
      await downloadAsset(platformAssetName(tool, "arm64"), appleSilicon);
      execFileSync("lipo", ["-create", "-output", output, intel, appleSilicon], {
        stdio: "inherit",
      });
      chmodSync(output, 0o755);
    } else {
      await downloadAsset(platformAssetName(tool), output);
    }

    if (!existsSync(output)) throw new Error(`${tool} sidecar was not created`);
    verifyBinary(output, tool);
  }

  console.log(
    `Bundled native FFmpeg and FFprobe sidecars for ${platform()}/${arch()} (no MPV libraries).`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
