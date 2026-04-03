#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const releaseDir = path.join(rootDir, 'release');

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveCommand(command) {
  return process.platform === 'win32' ? `${command}.cmd` : command;
}

function runCommand(command, args, options = {}) {
  const commandLabel = [command, ...args].join(' ');
  console.log(`\n> ${commandLabel}`);

  if (options.dryRun) {
    return;
  }

  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function extractSection(filePath, version) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const patterns = [
    new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*-.*$`),
    new RegExp(`^## \\[v${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*-.*$`),
  ];

  let capture = false;
  let found = false;
  const sectionLines = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const matched = patterns.some((pattern) => pattern.test(line));
      if (capture && !matched) {
        break;
      }
      if (matched) {
        capture = true;
        found = true;
      }
    }

    if (capture) {
      sectionLines.push(line);
    }
  }

  if (!found) {
    throw new Error(`在 ${path.basename(filePath)} 中未找到版本 ${version} 的更新日志段落`);
  }

  return sectionLines.join('\n').trim();
}

function buildReleaseNotes(version, outputDir) {
  const zhPath = path.join(rootDir, 'CHANGELOG.zh-CN.md');
  const enPath = path.join(rootDir, 'CHANGELOG.md');
  const zhSection = extractSection(zhPath, version);
  const enSection = extractSection(enPath, version);

  const notes = [
    '## 更新日志（中文）',
    '',
    zhSection,
    '',
    '## Changelog (English)',
    '',
    enSection,
    '',
  ].join('\n');

  const releaseNotesPath = path.join(outputDir, 'release-notes.md');
  fs.writeFileSync(releaseNotesPath, notes, 'utf8');
  return releaseNotesPath;
}

function validateReleaseNotes(version) {
  const zhPath = path.join(rootDir, 'CHANGELOG.zh-CN.md');
  const enPath = path.join(rootDir, 'CHANGELOG.md');
  extractSection(zhPath, version);
  extractSection(enPath, version);
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function walkFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function writeChecksums(artifactsDir, outputDir) {
  const lines = walkFiles(artifactsDir)
    .filter((filePath) => fs.statSync(filePath).isFile())
    .map((filePath) => {
      const relativePath = path.relative(artifactsDir, filePath);
      return `${sha256(filePath)}  ${relativePath}`;
    })
    .sort((left, right) => left.localeCompare(right, 'en'));

  const targetPath = path.join(outputDir, 'SHA256SUMS.txt');
  fs.writeFileSync(targetPath, `${lines.join('\n')}\n`, 'utf8');
  return targetPath;
}

function getBuildPlans() {
  if (process.platform === 'darwin') {
    return [
      {
        label: 'macOS Apple Silicon',
        buildArgs: ['electron-builder', '--mac', 'dmg', '--arm64'],
        platformId: 'darwin-arm64',
      },
      {
        label: 'macOS Intel',
        buildArgs: ['electron-builder', '--mac', 'dmg', '--x64'],
        platformId: 'darwin-x64',
      },
      {
        label: 'macOS Universal',
        buildArgs: ['electron-builder', '--mac', 'dmg', '--universal'],
        platformId: 'darwin-universal',
      },
    ];
  }

  if (process.platform === 'win32') {
    return [
      {
        label: 'Windows x64',
        buildArgs: ['electron-builder', '--win', 'nsis', '--x64'],
        platformId: 'windows-x64',
      },
    ];
  }

  if (process.platform === 'linux' && process.arch === 'arm64') {
    return [
      {
        label: 'Linux ARM64',
        buildArgs: ['electron-builder', '--linux', 'AppImage', 'deb', 'rpm', '--arm64'],
        platformId: 'linux-arm64',
      },
    ];
  }

  return [
    {
      label: 'Linux x64',
      buildArgs: ['electron-builder', '--linux', 'AppImage', 'deb', 'rpm', '--x64'],
      platformId: 'linux-x64',
    },
  ];
}

function getRepositorySlug(repositoryValue) {
  if (!repositoryValue) {
    return 'tangjiale/web-clone';
  }

  const raw =
    typeof repositoryValue === 'string'
      ? repositoryValue
      : typeof repositoryValue?.url === 'string'
        ? repositoryValue.url
        : '';

  const normalized = String(raw || '')
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '');

  if (/^[^/]+\/[^/]+$/.test(normalized)) {
    return normalized;
  }

  const match = normalized.match(/github\.com[:/]+([^/]+\/[^/]+)$/i);
  return match?.[1] || 'tangjiale/web-clone';
}

function main() {
  const args = parseArgs(process.argv);
  const dryRun = Boolean(args['dry-run']);
  const packageJson = readJson(packageJsonPath);
  const version = String(packageJson.version || '').trim();
  const repositorySlug = getRepositorySlug(packageJson.repository);

  if (!version) {
    throw new Error('package.json 缺少 version');
  }

  const outputDir = path.resolve(
    rootDir,
    String(args['output-dir'] || path.join('release-local', `v${version}`)),
  );
  const artifactsDir = path.join(outputDir, 'artifacts');
  const latestJsonPath = path.join(outputDir, 'latest.json');

  const buildPlans = getBuildPlans();
  console.log(`开始一键发版打包: v${version}`);
  console.log(`当前系统: ${process.platform}/${process.arch}`);
  console.log(`输出目录: ${outputDir}`);
  console.log(
    `构建目标: ${buildPlans.map((plan) => `${plan.label}(${plan.platformId})`).join(', ')}`,
  );

  if (!dryRun) {
    cleanDir(outputDir);
    ensureDir(artifactsDir);
    buildReleaseNotes(version, outputDir);
  } else {
    validateReleaseNotes(version);
  }

  runCommand(resolveCommand('npm'), ['run', 'sync-version'], { dryRun });
  runCommand(resolveCommand('npm'), ['run', 'rebuild:electron'], { dryRun });
  runCommand(resolveCommand('npm'), ['run', 'build'], { dryRun });

  for (const plan of buildPlans) {
    console.log(`\n=== 构建 ${plan.label} ===`);
    if (!dryRun) {
      cleanDir(releaseDir);
    }

    runCommand(resolveCommand('npx'), plan.buildArgs, { dryRun });
    runCommand(
      resolveCommand('node'),
      [
        './scripts/release/collect_release_artifacts.cjs',
        '--source-dir',
        'release',
        '--output-dir',
        path.relative(rootDir, artifactsDir),
        '--platform-id',
        plan.platformId,
        '--version',
        version,
      ],
      { dryRun },
    );
  }

  runCommand(
    resolveCommand('node'),
    [
      './scripts/release/build_latest_json.cjs',
      '--version',
      version,
      '--repo',
      repositorySlug,
      '--assets-dir',
      path.relative(rootDir, artifactsDir),
      '--notes-file',
      path.relative(rootDir, path.join(outputDir, 'release-notes.md')),
      '--published-at',
      new Date().toISOString(),
      '--release-url',
      `https://github.com/${repositorySlug}/releases/tag/v${version}`,
      '--output',
      path.relative(rootDir, latestJsonPath),
    ],
    { dryRun },
  );

  if (!dryRun) {
    writeChecksums(artifactsDir, outputDir);
  }

  console.log('\n发版打包完成。');
  console.log(`- Release 资产目录: ${artifactsDir}`);
  console.log(`- latest.json: ${latestJsonPath}`);
  console.log(`- release-notes.md: ${path.join(outputDir, 'release-notes.md')}`);
  console.log(`- SHA256SUMS.txt: ${path.join(outputDir, 'SHA256SUMS.txt')}`);
  console.log('\n下一步建议:');
  console.log(`1. 检查 ${outputDir} 下的产物是否正确`);
  console.log(`2. 提交代码并打 tag: v${version}`);
  console.log('3. 推送到 GitHub 触发 Actions 正式发布');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
