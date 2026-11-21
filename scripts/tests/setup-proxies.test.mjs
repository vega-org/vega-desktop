import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 as win32Path } from 'node:path';
import { extractZip, resolveWindowsTar } from '../setup-proxies.mjs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(fileName, content) {
  const nameBuf = Buffer.from(fileName, 'utf8');
  const dataBuf = Buffer.from(content, 'utf8');
  const checksum = crc32(dataBuf);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(dataBuf.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(dataBuf.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const localRecord = Buffer.concat([localHeader, nameBuf, dataBuf]);
  const centralRecord = Buffer.concat([centralHeader, nameBuf]);

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralRecord.length, 12);
  endRecord.writeUInt32LE(localRecord.length, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([localRecord, centralRecord, endRecord]);
}

test('resolveWindowsTar prefers System32 tar.exe and falls back to tar', () => {
  const expected = win32Path.join('C:\\Windows', 'System32', 'tar.exe');
  assert.equal(resolveWindowsTar({ SystemRoot: 'C:\\Windows' }, (p) => p === expected), expected);
  assert.equal(resolveWindowsTar({ SystemRoot: 'C:\\Windows' }, () => false), 'tar');
});

test('extractZip uses tar on Windows and unzip on Unix', () => {
  const calls = [];
  const execFile = (file, args, opts) => calls.push({ file, args, opts });

  extractZip('C:\\tmp\\usque.zip', 'C:\\tmp', {
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    existsSync: () => true,
    execFile,
  });
  extractZip('/tmp/usque.zip', '/tmp', {
    platform: 'linux',
    execFile,
  });

  assert.deepEqual(calls, [
    {
      file: win32Path.join('C:\\Windows', 'System32', 'tar.exe'),
      args: ['-xf', 'C:\\tmp\\usque.zip', '-C', 'C:\\tmp'],
      opts: { stdio: 'inherit' },
    },
    {
      file: 'unzip',
      args: ['-o', '/tmp/usque.zip', '-d', '/tmp'],
      opts: { stdio: 'inherit' },
    },
  ]);
});

test('extractZip extracts a real zip archive on Windows without PowerShell Expand-Archive', {
  skip: process.platform !== 'win32',
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'vega-proxy-zip-'));
  try {
    const zipPath = join(dir, 'sample.zip');
    writeFileSync(zipPath, createStoredZip('usque.exe', 'dummy-binary'));

    extractZip(zipPath, dir);

    assert.equal(readFileSync(join(dir, 'usque.exe'), 'utf8'), 'dummy-binary');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
