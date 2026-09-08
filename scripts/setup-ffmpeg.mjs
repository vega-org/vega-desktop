import { existsSync, mkdirSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const ffmpegDir = join(rootDir, "src-tauri", "resources", "ffmpeg");
const isWin = process.platform === "win32";

const ffmpegExe = join(ffmpegDir, isWin ? "ffmpeg.exe" : "ffmpeg");
const ffprobeExe = join(ffmpegDir, isWin ? "ffprobe.exe" : "ffprobe");

async function checkOrDownload() {
  // Check if already present in resources or in PATH
  if (existsSync(ffmpegExe) && existsSync(ffprobeExe)) {
    console.log("[setup-ffmpeg] FFmpeg and FFprobe binaries already exist in resources/ffmpeg");
    return;
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    execSync("ffprobe -version", { stdio: "ignore" });
    console.log("[setup-ffmpeg] FFmpeg and FFprobe found in system PATH");
    return;
  } catch {
    // Not in PATH
  }

  mkdirSync(ffmpegDir, { recursive: true });
  console.log("[setup-ffmpeg] Note: To package on Windows, place static ffmpeg.exe and ffprobe.exe in src-tauri/resources/ffmpeg/");
}

checkOrDownload().catch((err) => {
  console.error("[setup-ffmpeg] Setup encountered error:", err);
});
