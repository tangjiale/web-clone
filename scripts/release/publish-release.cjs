#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(rootDir, 'package.json');

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

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function captureCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const errorOutput = String(result.stderr || result.stdout || '').trim();
    throw new Error(errorOutput || `${command} 执行失败`);
  }

  return String(result.stdout || '').trim();
}

function getGitStatusLines() {
  const output = captureCommand(resolveCommand('git'), ['status', '--short']);
  if (!output) {
    return [];
  }

  return output.split(/\r?\n/).filter(Boolean);
}

function hasLocalTag(tagName) {
  const result = spawnSync(resolveCommand('git'), ['rev-parse', '-q', '--verify', `refs/tags/${tagName}`], {
    cwd: rootDir,
    stdio: 'ignore',
  });

  return result.status === 0;
}

function hasCachedChanges() {
  const result = spawnSync(resolveCommand('git'), ['diff', '--cached', '--quiet'], {
    cwd: rootDir,
    stdio: 'ignore',
  });

  return result.status === 1;
}

function main() {
  const args = parseArgs(process.argv);
  const dryRun = Boolean(args['dry-run']);
  const skipPackage = Boolean(args['skip-package']);
  const skipPush = Boolean(args['skip-push']);
  const packageJson = readJson(packageJsonPath);
  const version = String(packageJson.version || '').trim();

  if (!version) {
    throw new Error('package.json 缺少 version');
  }

  const branchName = captureCommand(resolveCommand('git'), ['branch', '--show-current']);
  if (!branchName) {
    throw new Error('当前不在可发布分支上，请先切回分支后再执行');
  }

  const tagName = String(args.tag || `v${version}`).trim();
  const commitMessage = String(args.message || `chore: release ${tagName}`).trim();
  const tagMessage = String(args['tag-message'] || `release ${tagName}`).trim();
  const statusLines = getGitStatusLines();

  if (hasLocalTag(tagName)) {
    throw new Error(`本地 tag ${tagName} 已存在，请先删除或升级版本号`);
  }

  console.log(`准备一键发布 ${tagName}`);
  console.log(`当前分支: ${branchName}`);
  console.log(`提交信息: ${commitMessage}`);
  console.log(`模式: ${dryRun ? 'dry-run' : '正式执行'}`);

  if (statusLines.length > 0) {
    console.log('\n当前待提交改动:');
    for (const line of statusLines) {
      console.log(`- ${line}`);
    }
  } else {
    console.log('\n当前工作区无未提交改动，将基于当前 HEAD 创建 tag。');
  }

  if (!skipPackage) {
    const packageArgs = dryRun
      ? ['run', 'release:package', '--', '--dry-run']
      : ['run', 'release:package'];
    runCommand(resolveCommand('npm'), packageArgs);
  } else {
    console.log('\n已跳过本地发版打包检查。');
  }

  runCommand(resolveCommand('git'), ['add', '-A'], { dryRun });

  const shouldCommit = dryRun ? statusLines.length > 0 : hasCachedChanges();

  if (shouldCommit) {
    runCommand(resolveCommand('git'), ['commit', '-m', commitMessage], { dryRun });
  } else {
    console.log('\n没有新的文件需要提交，跳过 commit。');
  }

  runCommand(resolveCommand('git'), ['tag', '-a', tagName, '-m', tagMessage], { dryRun });

  if (!skipPush) {
    runCommand(resolveCommand('git'), ['push', 'origin', branchName], { dryRun });
    runCommand(resolveCommand('git'), ['push', 'origin', tagName], { dryRun });
    if (dryRun) {
      console.log('\ndry-run 已预演推送分支与 tag，正式执行时会触发 GitHub Actions 自动发版。');
    } else {
      console.log('\n已推送分支与 tag，GitHub Actions 会开始自动发版。');
    }
  } else {
    console.log('\n已跳过 push，你可以稍后手动推送分支和 tag。');
  }

  console.log(`\n${dryRun ? '一键发布预演完成。' : '一键发布流程完成。'}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
