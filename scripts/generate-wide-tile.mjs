import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

async function generateWideTile() {
  const width = 310;
  const height = 150;
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  
  const icon = await loadImage(join(rootDir, 'src-tauri', 'icons', 'icon.png'));
  
  const iconSize = 120;
  const x = (width - iconSize) / 2;
  const y = (height - iconSize) / 2;
  ctx.drawImage(icon, x, y, iconSize, iconSize);
  
  const buffer = canvas.toBuffer('image/png');
  const outputPath = join(rootDir, 'src-tauri', 'gen', 'windows', 'Assets', 'Wide310x150Logo.png');
  writeFileSync(outputPath, buffer);
  console.log(`Wide tile generated at ${outputPath}`);
}

generateWideTile().catch(console.error);
