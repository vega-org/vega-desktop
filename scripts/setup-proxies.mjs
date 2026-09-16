import { execSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const resourcesDir = join(root, 'src-tauri', 'resources');
const byedpiDir = join(resourcesDir, 'byedpi');
const warpDir = join(resourcesDir, 'warp');

const BYEDPI_VERSION = '0.17.3';
const USQUE_VERSION = '4.2.1';

function findBinary(dir, prefix) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(fullPath, prefix);
      if (found) return found;
    } else if (entry.isFile()) {
      if (
        entry.name.startsWith(prefix) &&
        !entry.name.endsWith('.zip') &&
        !entry.name.endsWith('.tar.gz') &&
        !entry.name.endsWith('.md') &&
        !entry.name.endsWith('.txt')
      ) {
        return fullPath;
      }
    }
  }
  return null;
}

async function downloadFile(url, dest) {
  console.log(`Downloading ${url}...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
  console.log(`Saved ${buffer.length} bytes to ${dest}`);
}

async function setupByeDpi() {
  mkdirSync(byedpiDir, { recursive: true });
  const isWin = platform() === 'win32';
  const targetBinary = join(byedpiDir, isWin ? 'ciadpi.exe' : 'ciadpi');

  if (existsSync(targetBinary)) {
    console.log(`ByeDPI binary already exists at ${targetBinary}`);
    return;
  }

  if (platform() === 'darwin') {
    console.log('[setup-proxies] ByeDPI prebuilt release not available for macOS, skipping.');
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'byedpi-'));
  try {
    if (isWin) {
      const url = `https://github.com/hufrea/byedpi/releases/download/v${BYEDPI_VERSION}/byedpi-17.3-x86_64-w64.zip`;
      const zipPath = join(tmpDir, 'byedpi.zip');
      await downloadFile(url, zipPath);
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`, { stdio: 'inherit' });
    } else {
      const isArm = arch() === 'arm64';
      const archName = isArm ? 'aarch64' : 'x86_64';
      const url = `https://github.com/hufrea/byedpi/releases/download/v${BYEDPI_VERSION}/byedpi-17.3-${archName}.tar.gz`;
      const tarPath = join(tmpDir, 'byedpi.tar.gz');
      await downloadFile(url, tarPath);
      execSync(`tar -xzf "${tarPath}" -C "${tmpDir}"`, { stdio: 'inherit' });
    }

    const found = findBinary(tmpDir, 'ciadpi');
    if (found) {
      copyFileSync(found, targetBinary);
      if (!isWin) chmodSync(targetBinary, 0o755);
      console.log(`Extracted ByeDPI to ${targetBinary}`);
    } else {
      const files = readdirSync(tmpDir);
      throw new Error(`ciadpi binary not found in ${tmpDir} (files: ${files.join(', ')})`);
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

async function setupUsque() {
  mkdirSync(warpDir, { recursive: true });
  const isWin = platform() === 'win32';
  const targetBinary = join(warpDir, isWin ? 'usque.exe' : 'usque');

  if (existsSync(targetBinary)) {
    console.log(`Usque binary already exists at ${targetBinary}`);
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'usque-'));
  try {
    let osName = 'windows';
    if (platform() === 'linux') osName = 'linux';
    if (platform() === 'darwin') osName = 'darwin';

    let archName = arch() === 'arm64' ? 'arm64' : 'amd64';
    const zipName = `usque_${USQUE_VERSION}_${osName}_${archName}.zip`;
    const url = `https://github.com/Diniboy1123/usque/releases/download/v${USQUE_VERSION}/${zipName}`;
    const zipPath = join(tmpDir, 'usque.zip');

    await downloadFile(url, zipPath);

    if (isWin) {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`, { stdio: 'inherit' });
    } else {
      execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'inherit' });
    }

    const found = findBinary(tmpDir, 'usque');
    if (found) {
      copyFileSync(found, targetBinary);
      if (!isWin) chmodSync(targetBinary, 0o755);
      console.log(`Extracted Usque (WARP) to ${targetBinary}`);
    } else {
      const files = readdirSync(tmpDir);
      throw new Error(`usque binary not found in ${tmpDir} (files: ${files.join(', ')})`);
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  console.log('--- Setting up proxy binaries for vega-desktop ---');
  try {
    await setupByeDpi();
  } catch (err) {
    console.warn('[setup-proxies] Warning: Failed to setup ByeDPI:', err.message);
  }

  try {
    await setupUsque();
  } catch (err) {
    console.warn('[setup-proxies] Warning: Failed to setup Usque (WARP):', err.message);
  }
  console.log('--- Proxy binaries setup complete! ---');
}

main().catch((err) => {
  console.error('Failed to setup proxy binaries:', err);
  process.exit(1);
});
