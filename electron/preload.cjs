const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('error', (event) => {
  ipcRenderer.send('renderer:error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error?.stack || null,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  ipcRenderer.send('renderer:unhandledrejection', {
    reason:
      typeof event.reason === 'object' && event.reason
        ? event.reason.stack || event.reason.message || String(event.reason)
        : String(event.reason),
  });
});

contextBridge.exposeInMainWorld('desktopApi', {
  listSites: () => ipcRenderer.invoke('sites:list'),
  createSite: (payload) => ipcRenderer.invoke('sites:create', payload),
  updateSite: (payload) => ipcRenderer.invoke('sites:update', payload),
  deleteSite: (siteId) => ipcRenderer.invoke('sites:delete', siteId),
  listProfiles: (siteId) => ipcRenderer.invoke('profiles:list', siteId),
  listAllProfiles: () => ipcRenderer.invoke('profiles:list-all'),
  createProfile: (payload) => ipcRenderer.invoke('profiles:create', payload),
  updateProfile: (payload) => ipcRenderer.invoke('profiles:update', payload),
  deleteProfile: (profileId, removeStorage) =>
    ipcRenderer.invoke('profiles:delete', { profileId, removeStorage }),
  setSitePinned: (siteId, pinned) => ipcRenderer.invoke('sites:set-pinned', { siteId, pinned }),
  setSiteFavorite: (siteId, favorite) =>
    ipcRenderer.invoke('sites:set-favorite', { siteId, favorite }),
  setProfilePinned: (profileId, pinned) =>
    ipcRenderer.invoke('profiles:set-pinned', { profileId, pinned }),
  setProfileFavorite: (profileId, favorite) =>
    ipcRenderer.invoke('profiles:set-favorite', { profileId, favorite }),
  listRuntimeSessions: () => ipcRenderer.invoke('runtime:list'),
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadUpdate: (downloadUrl, fileName) =>
    ipcRenderer.invoke('app:download-update', { downloadUrl, fileName }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  openProfileEmbedded: (profileId) => ipcRenderer.invoke('runtime:open-embedded', profileId),
  openProfileExternal: (profileId) => ipcRenderer.invoke('runtime:open-external', profileId),
  closeProfile: (profileId) => ipcRenderer.invoke('runtime:close', profileId),
  clearProfileStorage: (profileId) => ipcRenderer.invoke('runtime:clear-storage', profileId),
  getProfileRuntimeState: (profileId) => ipcRenderer.invoke('runtime:get-state', profileId),
  setActiveEmbeddedProfile: (profileId) =>
    ipcRenderer.invoke('runtime:set-active-embedded', profileId),
  updateEmbeddedBounds: (bounds) => ipcRenderer.invoke('runtime:update-embedded-bounds', bounds),
  captureEmbeddedPreview: (profileId) =>
    ipcRenderer.invoke('runtime:capture-embedded-preview', profileId),
  updateEmbeddedSessionState: (profileId, payload) =>
    ipcRenderer.invoke('runtime:update-embedded-state', { profileId, payload }),
  navigateProfile: (profileId, url) => ipcRenderer.invoke('runtime:navigate', { profileId, url }),
  reloadProfile: (profileId) => ipcRenderer.invoke('runtime:reload', profileId),
  backProfile: (profileId) => ipcRenderer.invoke('runtime:back', profileId),
  forwardProfile: (profileId) => ipcRenderer.invoke('runtime:forward', profileId),
  goHomeProfile: (profileId) => ipcRenderer.invoke('runtime:go-home', profileId),
  openPath: (targetPath) => ipcRenderer.invoke('app:open-path', targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('app:show-item-in-folder', targetPath),
  openExternalUrl: (url) => ipcRenderer.invoke('app:open-external-url', url),
  onSessionsChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('runtime:sessions-changed', handler);
    return () => {
      ipcRenderer.removeListener('runtime:sessions-changed', handler);
    };
  },
});
