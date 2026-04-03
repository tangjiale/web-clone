#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const packageJson = readJson(packageJsonPath);
const version = String(packageJson.version || '').trim();

if (!version) {
  console.error('package.json 缺少 version 字段');
  process.exit(1);
}

const syncedFiles = [];

if (fs.existsSync(tauriConfigPath)) {
  const tauriConfig = readJson(tauriConfigPath);
  if (tauriConfig.version !== version) {
    tauriConfig.version = version;
    writeJson(tauriConfigPath, tauriConfig);
    syncedFiles.push(path.relative(rootDir, tauriConfigPath));
  }
}

console.log(`同步版本号完成: v${version}`);
if (syncedFiles.length) {
  for (const file of syncedFiles) {
    console.log(`- updated ${file}`);
  }
} else {
  console.log('- no additional files updated');
}
