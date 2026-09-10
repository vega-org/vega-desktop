import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const releaseTag = "b6.1.2-rc.1";
const releaseIdentity = `descriptinc/ffmpeg-ffprobe-static@${releaseTag}`;
const releaseBase =
  `https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/${releaseTag}`;
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
  if (tool === "ffmpeg") {
    const encoders = spawnSync(path, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    if (encoders.status !== 0 || !encoders.stdout.includes("libx264")) {
      throw new Error("Bundled FFmpeg does not provide the required libx264 encoder");
    }
  }
  if (platform() === "darwin") {
    const signature = spawnSync("codesign", ["--verify", path], { encoding: "utf8" });
    if (signature.status !== 0) {
      throw new Error(`${tool} is not validly signed: ${signature.stderr || "unknown error"}`);
    }
  }
}

function verifyPlaybackPipeline(ffmpegPath, ffprobePath, directory) {
  const sample = join(directory, "vega-ffmpeg-smoke.mp4");
  const encode = spawnSync(
    ffmpegPath,
    [
      "-v", "error",
      "-f", "lavfi", "-i", "color=c=black:s=320x180:r=24",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-t", "0.5",
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof+cmaf",
      "-f", "mp4", "-y", sample,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (encode.status !== 0) {
    throw new Error(`FFmpeg playback smoke test failed: ${encode.stderr || encode.error?.message}`);
  }

  const probe = spawnSync(
    ffprobePath,
    ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", sample],
    { encoding: "utf8", timeout: 15_000 },
  );
  const codecs = probe.stdout.toLowerCase();
  if (probe.status !== 0 || !codecs.includes("h264") || !codecs.includes("aac")) {
    throw new Error(`FFprobe playback smoke test failed: ${probe.stderr || codecs}`);
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
    const linuxCpu = { x64: "x64", arm64: "arm64" }[cpu];
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
const versionMarker = join(destination, ".vega-ffmpeg-version");
const installedRelease = existsSync(versionMarker)
  ? readFileSync(versionMarker, "utf8").trim()
  : "";
if (
  installedRelease === releaseIdentity &&
  existsSync(ffmpegOut) &&
  existsSync(ffprobeOut)
) {
  try {
    verifyBinary(ffmpegOut, "ffmpeg");
    verifyBinary(ffprobeOut, "ffprobe");
    const smokeDirectory = mkdtempSync(join(tmpdir(), "vega-ffmpeg-smoke-"));
    try {
      verifyPlaybackPipeline(ffmpegOut, ffprobeOut, smokeDirectory);
    } finally {
      rmSync(smokeDirectory, { recursive: true, force: true });
    }
    console.log(
      `Native FFmpeg sidecars and playback pipeline verified for ${platform()}/${arch()}.`,
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
      execFileSync("lipo", [output, "-verify_arch", "x86_64", "arm64"], {
        stdio: "inherit",
      });
      chmodSync(output, 0o755);
      // Combining slices invalidates signatures from the source binaries.
      // Tauri replaces this ad-hoc signature when signing a release bundle.
      execFileSync("codesign", ["--force", "--sign", "-", output], {
        stdio: "inherit",
      });
    } else {
      await downloadAsset(platformAssetName(tool), output);
    }

    if (!existsSync(output)) throw new Error(`${tool} sidecar was not created`);
    verifyBinary(output, tool);
  }

  verifyPlaybackPipeline(ffmpegOut, ffprobeOut, temporary);

  writeFileSync(versionMarker, `${releaseIdentity}\n`);

  console.log(
    `Bundled native FFmpeg and FFprobe sidecars for ${platform()}/${arch()} (no MPV libraries).`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
