#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  console.log(`copied ${path.basename(sourcePath)} -> ${path.basename(targetPath)}`);
}

function findFirst(files, matcher) {
  return files.find((filePath) => matcher(path.basename(filePath).toLowerCase(), filePath)) || null;
}

function maybeCopy(files, matcher, targetName, outputDir) {
  const sourcePath = findFirst(files, matcher);
  if (!sourcePath) {
    return null;
  }
  const targetPath = path.join(outputDir, targetName);
  copyFile(sourcePath, targetPath);
  return targetPath;
}

const args = parseArgs(process.argv);
const sourceDir = path.resolve(process.cwd(), String(args['source-dir'] || 'release'));
const outputDir = path.resolve(process.cwd(), String(args['output-dir'] || 'release-upload'));
const platformId = String(args['platform-id'] || '').trim();
const version = String(args.version || '').trim();
const productName = String(args['product-name'] || 'WebClone').trim();

if (!platformId) {
  console.error('缺少 --platform-id');
  process.exit(1);
}
if (!version) {
  console.error('缺少 --version');
  process.exit(1);
}

ensureDir(outputDir);
const files = walkFiles(sourceDir);

if (!files.length) {
  console.error(`未在 ${sourceDir} 找到构建产物`);
  process.exit(1);
}

const normalizedBase = `${productName}_${version}`;

const platformConfig = {
  'darwin-arm64': [
    ['dmg', (name) => name.endsWith('.dmg'), `${normalizedBase}_aarch64.dmg`],
    ['blockmap', (name) => name.endsWith('.dmg.blockmap') || name.endsWith('.blockmap'), `${normalizedBase}_aarch64.dmg.blockmap`],
  ],
  'darwin-x64': [
    ['dmg', (name) => name.endsWith('.dmg'), `${normalizedBase}_x64.dmg`],
    ['blockmap', (name) => name.endsWith('.dmg.blockmap') || name.endsWith('.blockmap'), `${normalizedBase}_x64.dmg.blockmap`],
  ],
  'darwin-universal': [
    ['dmg', (name) => name.endsWith('.dmg'), `${normalizedBase}_universal.dmg`],
    ['blockmap', (name) => name.endsWith('.dmg.blockmap') || name.endsWith('.blockmap'), `${normalizedBase}_universal.dmg.blockmap`],
  ],
  'linux-x64': [
    ['appimage', (name) => name.endsWith('.appimage'), `${normalizedBase}_amd64.AppImage`],
    ['deb', (name) => name.endsWith('.deb'), `${normalizedBase}_amd64.deb`],
    ['rpm', (name) => name.endsWith('.rpm'), `${productName}-${version}-1.x86_64.rpm`],
  ],
  'linux-arm64': [
    ['appimage', (name) => name.endsWith('.appimage'), `${normalizedBase}_aarch64.AppImage`],
    ['deb', (name) => name.endsWith('.deb'), `${normalizedBase}_arm64.deb`],
    ['rpm', (name) => name.endsWith('.rpm'), `${productName}-${version}-1.aarch64.rpm`],
  ],
  'windows-x64': [
    ['exe', (name) => name.endsWith('.exe'), `${normalizedBase}_x64-setup.exe`],
    ['blockmap', (name) => name.endsWith('.exe.blockmap') || name.endsWith('.blockmap'), `${normalizedBase}_x64-setup.exe.blockmap`],
    ['yml', (name) => name.endsWith('.yml') && !name.includes('builder-debug'), `latest-windows-x64.yml`],
  ],
};

const tasks = platformConfig[platformId];
if (!tasks) {
  console.error(`不支持的 platform-id: ${platformId}`);
  process.exit(1);
}

let copied = 0;
for (const [, matcher, targetName] of tasks) {
  const result = maybeCopy(files, matcher, targetName, outputDir);
  if (result) {
    copied += 1;
  }
}

if (!copied) {
  console.error(`未匹配到 ${platformId} 的可上传产物`);
  process.exit(1);
}

console.log(`收集完成，共 ${copied} 个文件`);
