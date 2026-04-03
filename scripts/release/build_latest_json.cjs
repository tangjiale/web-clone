#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8').trim();
}

function classifyPlatform(fileName) {
  const lower = fileName.toLowerCase();

  if (/_aarch64\.dmg$/.test(lower)) {
    return ['darwin-arm64', 'darwin-aarch64'];
  }
  if (/_x64\.dmg$/.test(lower)) {
    return ['darwin-x64', 'darwin-x86_64'];
  }
  if (/_universal\.dmg$/.test(lower)) {
    return ['darwin-universal'];
  }
  if (/_x64-setup\.exe$/.test(lower)) {
    return ['windows-x64', 'windows-x64-nsis', 'windows-x86_64', 'windows-x86_64-nsis'];
  }
  if (/_amd64\.appimage$/.test(lower)) {
    return ['linux-x64-appimage', 'linux-x86_64-appimage'];
  }
  if (/_aarch64\.appimage$/.test(lower)) {
    return ['linux-arm64-appimage', 'linux-aarch64-appimage'];
  }

  return [];
}

const args = parseArgs(process.argv);
const version = String(args.version || '').trim();
const repo = String(args.repo || '').trim();
const assetsDir = path.resolve(process.cwd(), String(args['assets-dir'] || 'release-assets'));
const outputPath = path.resolve(process.cwd(), String(args.output || 'latest.json'));
const notes = readTextIfExists(args['notes-file'] ? path.resolve(process.cwd(), args['notes-file']) : '');
const publishedAt = String(args['published-at'] || new Date().toISOString()).trim();
const releaseUrl =
  String(args['release-url'] || '').trim() ||
  (repo && version ? `https://github.com/${repo}/releases/tag/v${version}` : null);

if (!version) {
  console.error('缺少 --version');
  process.exit(1);
}
if (!repo) {
  console.error('缺少 --repo');
  process.exit(1);
}

const files = walkFiles(assetsDir)
  .filter((filePath) => fs.statSync(filePath).isFile())
  .filter((filePath) => !['latest.json', 'SHA256SUMS.txt'].includes(path.basename(filePath)));

if (!files.length) {
  console.error(`未在 ${assetsDir} 中找到 release 资产`);
  process.exit(1);
}

const assets = files
  .map((filePath) => {
    const name = path.basename(filePath);
    return {
      name,
      size: fs.statSync(filePath).size,
      sha256: sha256(filePath),
      url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(name)}`,
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name, 'en'));

const platforms = {};
for (const asset of assets) {
  const aliases = classifyPlatform(asset.name);
  for (const alias of aliases) {
    platforms[alias] = {
      url: asset.url,
      name: asset.name,
      signature: null,
      sha256: asset.sha256,
      size: asset.size,
    };
  }
}

const payload = {
  version,
  notes: notes || `Release v${version}`,
  pub_date: publishedAt,
  release_url: releaseUrl,
  platforms,
  assets,
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`已生成 ${outputPath}`);
