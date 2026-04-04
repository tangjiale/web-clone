const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { app, BrowserView, BrowserWindow, ipcMain, nativeImage, session, shell } = require('electron');
const { createDatabase, normalizeUrl } = require('./db.cjs');
const packageJson = require('../package.json');

const APP_NAME = '网站分身管理器';
const APP_ID = 'com.webclone.manager';
const APP_ICON_PNG = path.join(__dirname, '..', 'build-resources', 'icons', 'icon.png');
const DEV_SERVER_URL = process.env.WEB_CLONE_DEV_SERVER_URL || 'http://127.0.0.1:1420';

app.setName(APP_NAME);

let mainWindow = null;
let database = null;
const runtimeSessions = new Map();
const externalWindows = new Map();
const embeddedViews = new Map();
const CHROME_USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const guestPartitionToProfileId = new Map();
const pendingGuestAttachQueue = [];
const guestContentsToProfileId = new Map();
let embeddedBounds = { x: 0, y: 0, width: 0, height: 0 };

function getAppIcon() {
  const icon = nativeImage.createFromPath(APP_ICON_PNG);
  return icon.isEmpty() ? undefined : icon;
}

function getConfiguredDisplayVersion() {
  return app.getVersion();
}

function getAppInfo() {
  return {
    appName: APP_NAME,
    currentVersion: app.getVersion(),
    displayVersion: getConfiguredDisplayVersion(),
  };
}

function extractGitHubRepositorySlug(repositoryValue) {
  if (!repositoryValue) {
    return null;
  }

  const rawValue =
    typeof repositoryValue === 'string'
      ? repositoryValue
      : typeof repositoryValue?.url === 'string'
        ? repositoryValue.url
        : '';
  const value = String(rawValue || '')
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '');

  if (!value) {
    return null;
  }

  if (/^[^/]+\/[^/]+$/.test(value)) {
    return value;
  }

  const match = value.match(/github\.com[:/]+([^/]+\/[^/]+)$/i);
  return match?.[1] || null;
}

function getConfiguredUpdateCheckUrl() {
  const explicitUrl = String(process.env.WEB_CLONE_UPDATE_URL || packageJson.webCloneUpdateUrl || '')
    .trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const repositorySlug = extractGitHubRepositorySlug(packageJson.repository);
  if (!repositorySlug) {
    return '';
  }

  return `https://github.com/${repositorySlug}/releases/latest/download/latest.json`;
}

function normalizeVersionToken(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '');
}

function compareVersionStrings(left, right) {
  const leftParts = normalizeVersionToken(left).split(/[.-]/);
  const rightParts = normalizeVersionToken(right).split(/[.-]/);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? '0';
    const rightPart = rightParts[index] ?? '0';
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);

    if (bothNumeric) {
      if (leftNumber > rightNumber) {
        return 1;
      }
      if (leftNumber < rightNumber) {
        return -1;
      }
      continue;
    }

    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function resolveUpdateSourceUrl(sourceUrl) {
  const value = String(sourceUrl || '').trim();
  const githubLatestMatch = value.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/?$/i,
  );
  if (githubLatestMatch) {
    const [, owner, repo] = githubLatestMatch;
    return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  }
  return value;
}

function getReleaseAssetScore(asset) {
  const name = String(asset?.name || '').trim().toLowerCase();
  if (!name || typeof asset?.browser_download_url !== 'string') {
    return Number.NEGATIVE_INFINITY;
  }
  if (asset?.state && asset.state !== 'uploaded') {
    return Number.NEGATIVE_INFINITY;
  }
  if (/\.(blockmap|sig|yml|yaml|json|txt|sha256|sha512)$/i.test(name)) {
    return -1000;
  }

  let score = 0;
  if (process.platform === 'darwin') {
    if (name.endsWith('.dmg')) {
      score += 120;
    } else if (name.endsWith('.pkg')) {
      score += 80;
    } else if (name.endsWith('.zip')) {
      score += 40;
    }
    if (name.includes('mac') || name.includes('darwin') || name.includes('osx')) {
      score += 20;
    }
    if (name.includes('universal')) {
      score += 30;
    }
  } else if (process.platform === 'win32') {
    if (name.endsWith('.exe')) {
      score += 120;
    } else if (name.endsWith('.msi')) {
      score += 70;
    } else if (name.endsWith('.zip')) {
      score += 20;
    }
    if (name.includes('win') || name.includes('windows')) {
      score += 20;
    }
  } else {
    if (name.endsWith('.appimage')) {
      score += 120;
    } else if (name.endsWith('.deb') || name.endsWith('.rpm') || name.endsWith('.tar.gz')) {
      score += 60;
    }
    if (name.includes('linux')) {
      score += 20;
    }
  }

  if (process.arch === 'arm64') {
    if (name.includes('arm64') || name.includes('aarch64')) {
      score += 25;
    }
    if (name.includes('x64') || name.includes('amd64')) {
      score -= 10;
    }
  } else if (process.arch === 'x64') {
    if (name.includes('x64') || name.includes('amd64')) {
      score += 25;
    }
    if (name.includes('arm64') || name.includes('aarch64')) {
      score -= 10;
    }
  }

  if (name.includes('latest')) {
    score += 2;
  }

  return score;
}

function pickBestReleaseAsset(assets) {
  const candidates = Array.isArray(assets)
    ? assets.filter((asset) => typeof asset?.browser_download_url === 'string')
    : [];

  if (!candidates.length) {
    return null;
  }

  const ranked = candidates
    .map((asset) => ({
      asset,
      score: getReleaseAssetScore(asset),
    }))
    .sort((left, right) => right.score - left.score);

  if (!ranked.length || ranked[0].score < 0) {
    return null;
  }

  return ranked[0].asset;
}

function getCurrentPlatformKeys() {
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') {
      return ['darwin-arm64', 'darwin-aarch64', 'darwin-universal'];
    }
    return ['darwin-x64', 'darwin-x86_64', 'darwin-universal'];
  }

  if (process.platform === 'win32') {
    return ['windows-x64-nsis', 'windows-x86_64-nsis', 'windows-x64', 'windows-x86_64'];
  }

  if (process.arch === 'arm64') {
    return ['linux-arm64-appimage', 'linux-aarch64-appimage', 'linux-arm64', 'linux-aarch64'];
  }

  return ['linux-x64-appimage', 'linux-x86_64-appimage', 'linux-x64', 'linux-x86_64'];
}

function resolveManifestPlatformAsset(platforms) {
  if (!platforms || typeof platforms !== 'object') {
    return null;
  }

  const keys = getCurrentPlatformKeys();
  for (const key of keys) {
    const entry = platforms[key];
    if (!entry) {
      continue;
    }
    if (typeof entry === 'string') {
      return {
        url: entry,
        name: inferFileNameFromUrl(entry),
      };
    }
    if (typeof entry === 'object') {
      const url =
        String(
          entry.url || entry.browser_download_url || entry.downloadUrl || entry.path || '',
        ).trim() || null;
      if (!url) {
        continue;
      }
      return {
        url,
        name:
          String(entry.name || entry.fileName || entry.filename || '').trim() ||
          inferFileNameFromUrl(url),
      };
    }
  }

  return null;
}

function inferFileNameFromUrl(downloadUrl) {
  try {
    const url = new URL(downloadUrl);
    const rawName = decodeURIComponent(path.basename(url.pathname));
    return rawName || null;
  } catch {
    return null;
  }
}

function sanitizeFileName(fileName) {
  return String(fileName || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getUniqueDownloadPath(downloadsDir, fileName) {
  const parsed = path.parse(fileName);
  let nextPath = path.join(downloadsDir, fileName);
  let suffix = 1;

  while (true) {
    try {
      await fsp.access(nextPath);
      nextPath = path.join(downloadsDir, `${parsed.name} (${suffix})${parsed.ext}`);
      suffix += 1;
    } catch {
      return nextPath;
    }
  }
}

function extractUpdatePayload(data) {
  const latestVersion = normalizeVersionToken(data?.version || data?.tag_name || data?.name);
  if (!latestVersion) {
    throw new Error('更新检查地址返回的数据中缺少 version/tag_name 字段');
  }

  const platformAsset = resolveManifestPlatformAsset(data?.platforms);
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const preferredAsset = pickBestReleaseAsset(assets);
  const downloadUrl =
    String(
      data?.downloadUrl || platformAsset?.url || preferredAsset?.browser_download_url || '',
    ).trim() || null;
  const downloadFileName =
    String(
      data?.downloadFileName ||
        data?.fileName ||
        platformAsset?.name ||
        preferredAsset?.name ||
        '',
    ).trim() ||
    inferFileNameFromUrl(downloadUrl || '');

  return {
    latestVersion,
    releaseNotes: String(data?.releaseNotes || data?.notes || data?.body || '').trim() || null,
    releaseUrl:
      String(data?.releaseUrl || data?.html_url || data?.url || data?.release_url || '').trim() ||
      null,
    downloadUrl,
    downloadFileName: downloadFileName || null,
  };
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const displayVersion = getConfiguredDisplayVersion();
  const configuredSourceUrl = getConfiguredUpdateCheckUrl();
  const sourceUrl = resolveUpdateSourceUrl(configuredSourceUrl);
  const checkedAt = new Date().toISOString();

  if (!sourceUrl) {
    return {
      status: 'not_configured',
      currentVersion,
      displayVersion,
      latestVersion: null,
      checkedAt,
      sourceUrl: null,
      releaseNotes: null,
      releaseUrl: null,
      downloadUrl: null,
      downloadFileName: null,
      message: '请先在设置里填写更新检查地址',
    };
  }

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': `${APP_NAME}/${currentVersion}`,
      },
    });
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const parsed = extractUpdatePayload(data);
    const hasUpdate = compareVersionStrings(parsed.latestVersion, currentVersion) > 0;

    return {
      status: hasUpdate ? 'update_available' : 'up_to_date',
      currentVersion,
      displayVersion,
      latestVersion: parsed.latestVersion,
      checkedAt,
      sourceUrl,
      releaseNotes: parsed.releaseNotes,
      releaseUrl: parsed.releaseUrl,
      downloadUrl: parsed.downloadUrl,
      downloadFileName: parsed.downloadFileName,
      message: hasUpdate
        ? `发现新版本 v${parsed.latestVersion}`
        : `当前已是最新版本 v${currentVersion}`,
    };
  } catch (error) {
    return {
      status: 'error',
      currentVersion,
      displayVersion,
      latestVersion: null,
      checkedAt,
      sourceUrl,
      releaseNotes: null,
      releaseUrl: null,
      downloadUrl: null,
      downloadFileName: null,
      message: `检查更新失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function downloadUpdate({ downloadUrl, fileName } = {}) {
  const sourceUrl = String(downloadUrl || '').trim();
  if (!sourceUrl) {
    return {
      status: 'not_available',
      filePath: null,
      fileName: null,
      downloadsDir: null,
      sourceUrl: null,
      message: '当前更新源没有可下载的安装包',
    };
  }

  try {
    new URL(sourceUrl);
  } catch {
    return {
      status: 'error',
      filePath: null,
      fileName: null,
      downloadsDir: null,
      sourceUrl,
      message: '下载地址格式无效',
    };
  }

  const downloadsDir = path.join(app.getPath('downloads'), APP_NAME);
  await fsp.mkdir(downloadsDir, { recursive: true });

  const fallbackName =
    sanitizeFileName(fileName) ||
    sanitizeFileName(inferFileNameFromUrl(sourceUrl)) ||
    `${APP_NAME}-${app.getVersion()}${
      process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.exe' : '.bin'
    }`;
  const targetPath = await getUniqueDownloadPath(downloadsDir, fallbackName);

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: 'application/octet-stream, application/json, text/plain, */*',
        'User-Agent': `${APP_NAME}/${app.getVersion()}`,
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`请求失败: ${response.status} ${response.statusText}`);
    }

    if (response.body) {
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(targetPath));
    } else {
      const arrayBuffer = await response.arrayBuffer();
      await fsp.writeFile(targetPath, Buffer.from(arrayBuffer));
    }

    return {
      status: 'downloaded',
      filePath: targetPath,
      fileName: path.basename(targetPath),
      downloadsDir,
      sourceUrl,
      message: `更新包已下载到 ${targetPath}`,
    };
  } catch (error) {
    try {
      await fsp.rm(targetPath, { force: true });
    } catch {
      // ignore cleanup failures
    }

    return {
      status: 'error',
      filePath: null,
      fileName: null,
      downloadsDir,
      sourceUrl,
      message: `下载更新失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function buildPartition(storageKey) {
  return `persist:webclone:${storageKey}`;
}

function serializeRuntimeSession(sessionView) {
  return {
    ...sessionView,
    visible: Boolean(sessionView.visible),
  };
}

function listRuntimeSessions() {
  return Array.from(runtimeSessions.values())
    .map(serializeRuntimeSession)
    .sort((left, right) => {
      if (left.mode !== right.mode) {
        return left.mode === 'embedded' ? -1 : 1;
      }
      if (left.visible !== right.visible) {
        return left.visible ? -1 : 1;
      }
      return left.profileName.localeCompare(right.profileName, 'zh-CN');
    });
}

function emitSessionsChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('runtime:sessions-changed', listRuntimeSessions());
}

function sanitizeBounds(bounds) {
  return {
    x: Math.max(0, Math.floor(bounds?.x ?? 0)),
    y: Math.max(0, Math.floor(bounds?.y ?? 0)),
    width: Math.max(0, Math.floor(bounds?.width ?? 0)),
    height: Math.max(0, Math.floor(bounds?.height ?? 0)),
  };
}

function findProfileIdByPartition(partition) {
  if (!partition) {
    return null;
  }
  if (guestPartitionToProfileId.has(partition)) {
    return guestPartitionToProfileId.get(partition);
  }
  for (const [profileId, sessionView] of runtimeSessions.entries()) {
    if (sessionView.storagePartition === partition) {
      return profileId;
    }
  }
  return null;
}

function findProfileIdByGuestContentsId(contentsId) {
  return guestContentsToProfileId.get(contentsId) ?? null;
}

function updateEmbeddedRuntime(profileId, patch) {
  const current = runtimeSessions.get(profileId);
  if (!current || current.mode !== 'embedded') {
    return;
  }
  runtimeSessions.set(profileId, {
    ...current,
    ...patch,
  });
  emitSessionsChanged();
}

function getRuntimeState(profileId) {
  const sessionView = runtimeSessions.get(profileId);
  return {
    profileId,
    status: sessionView?.status || 'idle',
    currentUrl: sessionView?.currentUrl || null,
    mode: sessionView?.mode || null,
  };
}

function buildSessionView(bundle, mode, currentUrl) {
  return {
    profileId: bundle.profile.id,
    siteId: bundle.site.id,
    profileName: bundle.profile.name,
    mode,
    status: mode === 'embedded' ? 'embedded_open' : 'external_open',
    windowLabel: mode === 'embedded' ? 'main' : `external:${bundle.profile.id}`,
    webviewLabel: mode === 'embedded' ? `embedded:${bundle.profile.id}` : '',
    currentUrl: currentUrl || bundle.site.homeUrl,
    homeUrl: bundle.site.homeUrl,
    visible: mode === 'embedded',
    storagePartition: buildPartition(bundle.profile.storageKey),
    canGoBack: false,
    canGoForward: false,
    loadingState: mode === 'embedded' ? 'idle' : 'ready',
    lastError: null,
  };
}

function getActiveEmbeddedProfileId() {
  return (
    Array.from(runtimeSessions.values()).find(
      (sessionView) => sessionView.mode === 'embedded' && sessionView.visible,
    )?.profileId ?? null
  );
}

function syncEmbeddedNavigationState(profileId, patch = {}) {
  const current = runtimeSessions.get(profileId);
  const view = embeddedViews.get(profileId);
  if (!current || current.mode !== 'embedded' || !view || view.webContents.isDestroyed()) {
    return;
  }

  let currentUrl = current.currentUrl;
  try {
    currentUrl = view.webContents.getURL() || current.currentUrl || current.homeUrl;
  } catch {
    currentUrl = current.currentUrl || current.homeUrl;
  }

  runtimeSessions.set(profileId, {
    ...current,
    currentUrl,
    canGoBack: view.webContents.canGoBack(),
    canGoForward: view.webContents.canGoForward(),
    ...patch,
  });
  emitSessionsChanged();
}

function detachEmbeddedViews() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  for (const view of mainWindow.getBrowserViews()) {
    try {
      mainWindow.removeBrowserView(view);
    } catch {
      // ignore detach failures during teardown
    }
  }
}

function applyActiveEmbeddedView() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  detachEmbeddedViews();

  const activeProfileId = getActiveEmbeddedProfileId();
  if (!activeProfileId) {
    return;
  }

  const view = embeddedViews.get(activeProfileId);
  const current = runtimeSessions.get(activeProfileId);
  if (!view || !current || current.mode !== 'embedded') {
    return;
  }

  const bounds = sanitizeBounds(embeddedBounds);
  if (bounds.width <= 0 || bounds.height <= 0) {
    return;
  }

  mainWindow.addBrowserView(view);
  if (typeof mainWindow.setTopBrowserView === 'function') {
    try {
      mainWindow.setTopBrowserView(view);
    } catch {
      // ignore if not supported on current platform/runtime
    }
  }
  view.setBounds(bounds);
  view.setAutoResize({ width: true, height: true });
}

function setEmbeddedBounds(bounds) {
  embeddedBounds = sanitizeBounds(bounds);
  console.info('[main] embedded-bounds', embeddedBounds);
  applyActiveEmbeddedView();
}

async function captureEmbeddedPreview(profileId) {
  const current = runtimeSessions.get(profileId);
  const view = embeddedViews.get(profileId);
  if (!current || current.mode !== 'embedded' || !view || view.webContents.isDestroyed()) {
    return null;
  }

  try {
    const image = await view.webContents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  } catch (error) {
    console.error('[embedded-view:capture-preview failed]', profileId, error);
    return null;
  }
}

function destroyEmbeddedView(profileId) {
  const view = embeddedViews.get(profileId);
  if (!view) {
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.removeBrowserView(view);
    } catch {
      // ignore detach failures during teardown
    }
  }

  embeddedViews.delete(profileId);
  try {
    view.webContents.close({ waitForBeforeUnload: false });
  } catch {
    try {
      view.webContents.destroy();
    } catch {
      // ignore destroy failures during shutdown
    }
  }
}

function bindEmbeddedView(profileId, view) {
  view.setBackgroundColor('#ffffff');
  view.webContents.setUserAgent(CHROME_USER_AGENT);
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  view.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    console.info('[embedded-view:did-start-navigation]', profileId, { url, isInPlace, isMainFrame });
    if (isMainFrame) {
      syncEmbeddedNavigationState(profileId, {
        currentUrl: url,
        loadingState: 'loading',
        lastError: null,
      });
    }
  });

  view.webContents.on('did-navigate', (_event, url) => {
    syncEmbeddedNavigationState(profileId, {
      currentUrl: url,
      loadingState: 'ready',
      lastError: null,
    });
  });

  view.webContents.on('did-navigate-in-page', (_event, url) => {
    syncEmbeddedNavigationState(profileId, {
      currentUrl: url,
      loadingState: 'ready',
      lastError: null,
    });
  });

  view.webContents.on('dom-ready', () => {
    console.info('[embedded-view:dom-ready]', profileId, view.webContents.getURL());
    syncEmbeddedNavigationState(profileId, {
      loadingState: 'ready',
      lastError: null,
    });
  });

  view.webContents.on('did-finish-load', () => {
    console.info('[embedded-view:did-finish-load]', profileId, view.webContents.getURL());
    syncEmbeddedNavigationState(profileId, {
      loadingState: 'ready',
      lastError: null,
    });
  });

  view.webContents.on('did-stop-loading', () => {
    console.info('[embedded-view:did-stop-loading]', profileId, view.webContents.getURL());
    syncEmbeddedNavigationState(profileId, {
      loadingState: 'ready',
      lastError: null,
    });
  });

  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) {
      console.info('[embedded-view:did-fail-load ignored]', profileId, {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
      return;
    }

    console.error('[embedded-view:did-fail-load]', profileId, {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
    syncEmbeddedNavigationState(profileId, {
      currentUrl: validatedURL || null,
      loadingState: 'failed',
      lastError: `加载失败: ${errorDescription} (${errorCode})`,
    });
  });

  view.webContents.on('render-process-gone', (_event, details) => {
    console.error('[embedded-view:render-process-gone]', profileId, details);
    syncEmbeddedNavigationState(profileId, {
      loadingState: 'failed',
      lastError: `渲染进程退出: ${details.reason ?? '未知原因'}`,
    });
  });

  view.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.info('[embedded-view:console]', profileId, { level, message, line, sourceId });
  });
}

function ensureEmbeddedView(profileId) {
  const existing = embeddedViews.get(profileId);
  if (existing && !existing.webContents.isDestroyed()) {
    return existing;
  }

  const current = runtimeSessions.get(profileId);
  if (!current || current.mode !== 'embedded') {
    throw new Error('内嵌分身会话不存在');
  }

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: current.storagePartition,
      sandbox: true,
    },
  });
  bindEmbeddedView(profileId, view);
  embeddedViews.set(profileId, view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  view.webContents.loadURL(current.currentUrl || current.homeUrl);
  return view;
}

function focusWindow(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return;
  }
  if (windowInstance.isMinimized()) {
    windowInstance.restore();
  }
  windowInstance.show();
  windowInstance.focus();
}

async function clearPartitionStorage(partition) {
  const partitionSession = session.fromPartition(partition);
  await partitionSession.clearStorageData({
    storages: [
      'appcache',
      'cookies',
      'filesystem',
      'indexdb',
      'localstorage',
      'serviceworkers',
      'shadercache',
      'websql',
    ],
    quotas: ['temporary', 'persistent', 'syncable'],
  });
  await partitionSession.clearCache();
}

function removeEmbeddedSession(profileId) {
  const current = runtimeSessions.get(profileId);
  if (!current || current.mode !== 'embedded') {
    return;
  }
  destroyEmbeddedView(profileId);
  guestPartitionToProfileId.delete(current.storagePartition);
  for (const [contentsId, mappedProfileId] of guestContentsToProfileId.entries()) {
    if (mappedProfileId === profileId) {
      guestContentsToProfileId.delete(contentsId);
    }
  }
  runtimeSessions.delete(profileId);
}

function closeExternalWindow(profileId) {
  const windowInstance = externalWindows.get(profileId);
  if (!windowInstance) {
    runtimeSessions.delete(profileId);
    return;
  }
  externalWindows.delete(profileId);
  if (!windowInstance.isDestroyed()) {
    windowInstance.destroy();
  }
  runtimeSessions.delete(profileId);
}

function bindExternalWindow(profileId, windowInstance) {
  const syncCurrentUrl = () => {
    const current = runtimeSessions.get(profileId);
    if (!current) {
      return;
    }
    const nextUrl = windowInstance.webContents.getURL() || current.currentUrl || current.homeUrl;
    runtimeSessions.set(profileId, {
      ...current,
      currentUrl: nextUrl,
    });
    emitSessionsChanged();
  };

  windowInstance.webContents.on('did-navigate', (_event, url) => {
    const current = runtimeSessions.get(profileId);
    if (!current) {
      return;
    }
    runtimeSessions.set(profileId, {
      ...current,
      currentUrl: url,
    });
    emitSessionsChanged();
  });

  windowInstance.webContents.on('did-navigate-in-page', (_event, url) => {
    const current = runtimeSessions.get(profileId);
    if (!current) {
      return;
    }
    runtimeSessions.set(profileId, {
      ...current,
      currentUrl: url,
    });
    emitSessionsChanged();
  });

  windowInstance.webContents.on('did-finish-load', syncCurrentUrl);

  windowInstance.on('focus', () => {
    const current = runtimeSessions.get(profileId);
    if (!current) {
      return;
    }
    runtimeSessions.set(profileId, {
      ...current,
      visible: true,
    });
    emitSessionsChanged();
  });

  windowInstance.on('closed', () => {
    externalWindows.delete(profileId);
    runtimeSessions.delete(profileId);
    emitSessionsChanged();
  });
}

function createExternalWindow(bundle, initialUrl) {
  const sessionView = buildSessionView(bundle, 'external', initialUrl);
  const windowInstance = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    title: `${APP_NAME} · ${bundle.site.name} - ${bundle.profile.name}`,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    icon: getAppIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: sessionView.storagePartition,
      sandbox: true,
    },
  });

  runtimeSessions.set(bundle.profile.id, sessionView);
  externalWindows.set(bundle.profile.id, windowInstance);
  windowInstance.webContents.setUserAgent(CHROME_USER_AGENT);
  bindExternalWindow(bundle.profile.id, windowInstance);
  windowInstance.loadURL(sessionView.currentUrl);
  focusWindow(windowInstance);
  emitSessionsChanged();
  return sessionView;
}

function openEmbeddedProfile(profileId) {
  const bundle = database.getProfileBundle(profileId);
  if (!bundle) {
    throw new Error('分身不存在');
  }

  const existing = runtimeSessions.get(profileId);
  if (existing?.mode === 'embedded') {
    runtimeSessions.set(profileId, {
      ...existing,
      visible: true,
    });
    for (const [id, sessionView] of runtimeSessions.entries()) {
      if (id !== profileId && sessionView.mode === 'embedded' && sessionView.visible) {
        runtimeSessions.set(id, {
          ...sessionView,
          visible: false,
        });
      }
    }
    emitSessionsChanged();
    ensureEmbeddedView(profileId);
    applyActiveEmbeddedView();
    focusWindow(mainWindow);
    return runtimeSessions.get(profileId);
  }

  if (existing?.mode === 'external') {
    const currentUrl = existing.currentUrl;
    closeExternalWindow(profileId);
    runtimeSessions.delete(profileId);
    const sessionView = buildSessionView(bundle, 'embedded', currentUrl);
    for (const [id, currentSession] of runtimeSessions.entries()) {
      if (currentSession.mode === 'embedded') {
        runtimeSessions.set(id, {
          ...currentSession,
          visible: false,
        });
      }
    }
    runtimeSessions.set(profileId, sessionView);
    guestPartitionToProfileId.set(sessionView.storagePartition, profileId);
    database.markProfileOpened(profileId);
    ensureEmbeddedView(profileId);
    applyActiveEmbeddedView();
    emitSessionsChanged();
    focusWindow(mainWindow);
    return sessionView;
  }

  const sessionView = buildSessionView(bundle, 'embedded');
  for (const [id, currentSession] of runtimeSessions.entries()) {
    if (currentSession.mode === 'embedded') {
      runtimeSessions.set(id, {
        ...currentSession,
        visible: false,
      });
    }
  }
  runtimeSessions.set(profileId, sessionView);
  guestPartitionToProfileId.set(sessionView.storagePartition, profileId);
  database.markProfileOpened(profileId);
  ensureEmbeddedView(profileId);
  applyActiveEmbeddedView();
  emitSessionsChanged();
  focusWindow(mainWindow);
  return sessionView;
}

function openExternalProfile(profileId) {
  const bundle = database.getProfileBundle(profileId);
  if (!bundle) {
    throw new Error('分身不存在');
  }

  const existing = runtimeSessions.get(profileId);
  if (existing?.mode === 'external') {
    focusWindow(externalWindows.get(profileId));
    return existing;
  }

  if (existing?.mode === 'embedded') {
    removeEmbeddedSession(profileId);
    applyActiveEmbeddedView();
    emitSessionsChanged();
    database.markProfileOpened(profileId);
    return createExternalWindow(bundle, existing.currentUrl);
  }

  database.markProfileOpened(profileId);
  return createExternalWindow(bundle);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f4f7fb',
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  });

  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    params.useragent = CHROME_USER_AGENT;
    const partition = webPreferences.partition || params.partition || null;
    const profileId = findProfileIdByPartition(partition);
    if (profileId) {
      pendingGuestAttachQueue.push({
        profileId,
        partition,
        src: params.src,
      });
    }
    console.info('[main] will-attach-webview', {
      src: params.src,
      partition,
      profileId,
    });
    delete webPreferences.preload;
  });

  mainWindow.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setUserAgent(CHROME_USER_AGENT);
    const pending = pendingGuestAttachQueue.shift() ?? null;
    const profileId = pending?.profileId ?? null;
    if (profileId) {
      guestContentsToProfileId.set(contents.id, profileId);
    }
    console.info('[main] did-attach-webview', contents.id, {
      profileId,
      partition: pending?.partition ?? null,
      src: pending?.src ?? null,
    });

    if (profileId) {
      updateEmbeddedRuntime(profileId, {
        loadingState: 'loading',
        lastError: null,
      });
    }

    contents.on('did-start-navigation', (_navEvent, url, isInPlace, isMainFrame) => {
      console.info('[webview:did-start-navigation]', contents.id, { url, isInPlace, isMainFrame });
      const sessionProfileId = findProfileIdByGuestContentsId(contents.id);
      if (sessionProfileId && isMainFrame) {
        updateEmbeddedRuntime(sessionProfileId, {
          currentUrl: url,
          loadingState: 'loading',
          lastError: null,
        });
      }
    });

    contents.on('did-finish-load', () => {
      console.info('[webview:did-finish-load]', contents.id, contents.getURL());
      const sessionProfileId = findProfileIdByGuestContentsId(contents.id);
      if (sessionProfileId) {
        updateEmbeddedRuntime(sessionProfileId, {
          currentUrl: contents.getURL(),
          loadingState: 'ready',
          lastError: null,
        });
      }
    });

    contents.on('did-stop-loading', () => {
      console.info('[webview:did-stop-loading]', contents.id, contents.getURL());
      const sessionProfileId = findProfileIdByGuestContentsId(contents.id);
      if (sessionProfileId) {
        updateEmbeddedRuntime(sessionProfileId, {
          currentUrl: contents.getURL(),
          loadingState: 'ready',
          lastError: null,
        });
      }
    });

    contents.on('did-fail-load', (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (errorCode === -3) {
        console.info('[webview:did-fail-load ignored]', contents.id, {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
        });
        return;
      }
      console.error('[webview:did-fail-load]', contents.id, {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
      const sessionProfileId = findProfileIdByGuestContentsId(contents.id);
      if (sessionProfileId && isMainFrame) {
        updateEmbeddedRuntime(sessionProfileId, {
          currentUrl: validatedURL,
          loadingState: 'failed',
          lastError: `加载失败: ${errorDescription} (${errorCode})`,
        });
      }
    });

    contents.on('render-process-gone', (_goneEvent, details) => {
      console.error('[webview:render-process-gone]', contents.id, details);
      const sessionProfileId = findProfileIdByGuestContentsId(contents.id);
      if (sessionProfileId) {
        updateEmbeddedRuntime(sessionProfileId, {
          loadingState: 'failed',
          lastError: `渲染进程退出: ${details.reason ?? '未知原因'}`,
        });
      }
    });

    contents.once('destroyed', () => {
      guestContentsToProfileId.delete(contents.id);
    });
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.info('[renderer:console]', { level, message, line, sourceId });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer:render-process-gone]', details);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[renderer:did-fail-load]', {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const shouldUseDevServer = process.env.WEB_CLONE_DEV === '1' || !app.isPackaged;
  console.info('[main] renderer-source', {
    isPackaged: app.isPackaged,
    shouldUseDevServer,
    devServerUrl: DEV_SERVER_URL,
  });

  if (!shouldUseDevServer) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL(DEV_SERVER_URL);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    emitSessionsChanged();
    applyActiveEmbeddedView();
  });

  mainWindow.on('resize', () => {
    applyActiveEmbeddedView();
  });

  mainWindow.on('enter-full-screen', () => {
    applyActiveEmbeddedView();
  });

  mainWindow.on('leave-full-screen', () => {
    applyActiveEmbeddedView();
  });
}

function registerIpcHandlers() {
  ipcMain.on('renderer:error', (_event, payload) => {
    console.error('[renderer:error]', payload);
  });
  ipcMain.on('renderer:unhandledrejection', (_event, payload) => {
    console.error('[renderer:unhandledrejection]', payload);
  });
  ipcMain.handle('app:get-info', () => getAppInfo());
  ipcMain.handle('app:check-for-updates', () => checkForUpdates());
  ipcMain.handle('app:download-update', (_event, payload) => downloadUpdate(payload));
  ipcMain.handle('app:open-path', (_event, targetPath) => shell.openPath(String(targetPath || '')));
  ipcMain.handle('app:show-item-in-folder', (_event, targetPath) =>
    shell.showItemInFolder(String(targetPath || '')),
  );
  ipcMain.handle('app:open-external-url', (_event, url) => shell.openExternal(String(url || '')));
  ipcMain.handle('sites:list', () => database.listSites());
  ipcMain.handle('sites:create', (_event, payload) => database.createSite(payload));
  ipcMain.handle('sites:update', (_event, payload) => database.updateSite(payload));
  ipcMain.handle('sites:delete', (_event, siteId) => {
    database.deleteSite(siteId);
  });
  ipcMain.handle('sites:set-pinned', (_event, { siteId, pinned }) =>
    database.setSitePinned(siteId, pinned),
  );
  ipcMain.handle('sites:set-favorite', (_event, { siteId, favorite }) =>
    database.setSiteFavorite(siteId, favorite),
  );

  ipcMain.handle('profiles:list', (_event, siteId) => database.listProfiles(siteId));
  ipcMain.handle('profiles:list-all', () => database.listAllProfiles());
  ipcMain.handle('profiles:create', (_event, payload) => database.createProfile(payload));
  ipcMain.handle('profiles:update', (_event, payload) => database.updateProfile(payload));
  ipcMain.handle('profiles:delete', async (_event, { profileId, removeStorage }) => {
    if (removeStorage) {
      await clearProfileStorage(profileId);
    } else {
      await closeProfile(profileId);
    }
    database.deleteProfile(profileId);
  });
  ipcMain.handle('profiles:set-pinned', (_event, { profileId, pinned }) =>
    database.setProfilePinned(profileId, pinned),
  );
  ipcMain.handle('profiles:set-favorite', (_event, { profileId, favorite }) =>
    database.setProfileFavorite(profileId, favorite),
  );

  ipcMain.handle('settings:get', () => database.getSettings());
  ipcMain.handle('settings:update', (_event, settings) => database.updateSettings(settings));

  ipcMain.handle('runtime:list', () => listRuntimeSessions());
  ipcMain.handle('runtime:open-embedded', (_event, profileId) => openEmbeddedProfile(profileId));
  ipcMain.handle('runtime:open-external', (_event, profileId) => openExternalProfile(profileId));
  ipcMain.handle('runtime:get-state', (_event, profileId) => getRuntimeState(profileId));
  ipcMain.handle('runtime:set-active-embedded', (_event, profileId) => {
    for (const [id, sessionView] of runtimeSessions.entries()) {
      if (sessionView.mode !== 'embedded') {
        continue;
      }
      runtimeSessions.set(id, {
        ...sessionView,
        visible: profileId ? id === profileId : false,
      });
    }
    if (profileId) {
      ensureEmbeddedView(profileId);
    }
    applyActiveEmbeddedView();
    emitSessionsChanged();
  });
  ipcMain.handle('runtime:update-embedded-bounds', (_event, bounds) => {
    setEmbeddedBounds(bounds);
  });
  ipcMain.handle('runtime:capture-embedded-preview', (_event, profileId) =>
    captureEmbeddedPreview(profileId),
  );
  ipcMain.handle('runtime:update-embedded-state', (_event, { profileId, payload }) => {
    const current = runtimeSessions.get(profileId);
    if (!current || current.mode !== 'embedded') {
      return getRuntimeState(profileId);
    }
    runtimeSessions.set(profileId, {
      ...current,
      ...payload,
    });
    emitSessionsChanged();
    return getRuntimeState(profileId);
  });
  ipcMain.handle('runtime:close', (_event, profileId) => closeProfile(profileId));
  ipcMain.handle('runtime:clear-storage', (_event, profileId) => clearProfileStorage(profileId));
  ipcMain.handle('runtime:navigate', (_event, { profileId, url }) => navigateProfile(profileId, url));
  ipcMain.handle('runtime:reload', (_event, profileId) => {
    const current = runtimeSessions.get(profileId);
    if (!current) {
      return;
    }
    if (current.mode === 'external') {
      const windowInstance = externalWindows.get(profileId);
      if (windowInstance && !windowInstance.isDestroyed()) {
        windowInstance.webContents.reload();
      }
      return;
    }
    const view = embeddedViews.get(profileId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload();
    }
  });
  ipcMain.handle('runtime:back', (_event, profileId) => {
    const current = runtimeSessions.get(profileId);
    if (!current) {
      return;
    }
    if (current.mode === 'external') {
      const windowInstance = externalWindows.get(profileId);
      if (windowInstance?.webContents.canGoBack()) {
        windowInstance.webContents.goBack();
      }
      return;
    }
    const view = embeddedViews.get(profileId);
    if (view?.webContents.canGoBack()) {
      view.webContents.goBack();
    }
  });
  ipcMain.handle('runtime:forward', (_event, profileId) => {
    const current = runtimeSessions.get(profileId);
    if (!current) {
      return;
    }
    if (current.mode === 'external') {
      const windowInstance = externalWindows.get(profileId);
      if (windowInstance?.webContents.canGoForward()) {
        windowInstance.webContents.goForward();
      }
      return;
    }
    const view = embeddedViews.get(profileId);
    if (view?.webContents.canGoForward()) {
      view.webContents.goForward();
    }
  });
  ipcMain.handle('runtime:go-home', (_event, profileId) => {
    const current = runtimeSessions.get(profileId);
    if (!current) {
      return;
    }
    return navigateProfile(profileId, current.homeUrl);
  });
}

async function closeProfile(profileId) {
  const current = runtimeSessions.get(profileId);
  if (!current) {
    return;
  }
  if (current.mode === 'external') {
    closeExternalWindow(profileId);
  } else {
    removeEmbeddedSession(profileId);
  }
  emitSessionsChanged();
}

async function clearProfileStorage(profileId) {
  const bundle = database.getProfileBundle(profileId);
  if (!bundle) {
    throw new Error('分身不存在');
  }

  await closeProfile(profileId);
  await clearPartitionStorage(buildPartition(bundle.profile.storageKey));
}

function navigateProfile(profileId, url) {
  const current = runtimeSessions.get(profileId);
  if (!current) {
    throw new Error('分身未打开');
  }
  const nextUrl = normalizeUrl(url);
  runtimeSessions.set(profileId, {
    ...current,
    currentUrl: nextUrl,
  });

  if (current.mode === 'external') {
    const windowInstance = externalWindows.get(profileId);
    if (windowInstance && !windowInstance.isDestroyed()) {
      windowInstance.loadURL(nextUrl);
    }
  } else {
    const view = ensureEmbeddedView(profileId);
    runtimeSessions.set(profileId, {
      ...runtimeSessions.get(profileId),
      currentUrl: nextUrl,
      loadingState: 'loading',
      lastError: null,
    });
    view.webContents.loadURL(nextUrl);
    applyActiveEmbeddedView();
  }

  emitSessionsChanged();
  return getRuntimeState(profileId);
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  app.setAppUserModelId(APP_ID);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
  });
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = getAppIcon();
    if (dockIcon) {
      app.dock.setIcon(dockIcon);
    }
  }

  app.on('certificate-error', (event, webContents, url, error, _certificate, callback) => {
    console.error('[certificate-error]', {
      webContentsId: webContents?.id,
      url,
      error,
    });
    callback(false);
    event.preventDefault();
  });

  database = createDatabase({ userData: app.getPath('userData') });
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      return;
    }
    focusWindow(mainWindow);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  detachEmbeddedViews();
  for (const profileId of embeddedViews.keys()) {
    destroyEmbeddedView(profileId);
  }
  if (database) {
    database.close();
  }
});
