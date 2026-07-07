import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, 'node_modules', 'tauri-plugin-libmpv-api', 'dist-js', 'cli.js');

if (!existsSync(cliPath)) {
  console.log('tauri-plugin-libmpv-api not installed yet, skipping setup-lib');
  process.exit(0);
}

const PINNED_MPV_TAG = '2026-07-06-c8c7d91a8e';
const PINNED_URL = `https://github.com/zhongfly/mpv-winbuild/releases/download/${PINNED_MPV_TAG}`;

let content = readFileSync(cliPath, 'utf-8');
const originalUrl = 'https://github.com/zhongfly/mpv-winbuild/releases/latest/download';
if (content.includes(originalUrl)) {
  content = content.replace(originalUrl, PINNED_URL);
  writeFileSync(cliPath, content, 'utf-8');
  console.log(`[setup-lib] Pinned mpv-winbuild to release: ${PINNED_MPV_TAG}`);
}

execSync('npx tauri-plugin-libmpv-api setup-lib', { stdio: 'inherit', cwd: __dirname });
