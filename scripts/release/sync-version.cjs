#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = String(packageJson.version || '').trim();

if (!version) {
  console.error('package.json 缺少 version 字段');
  process.exit(1);
}

console.log(`同步版本号完成: v${version}`);
console.log('- Electron-only project: no additional manifests to sync');
