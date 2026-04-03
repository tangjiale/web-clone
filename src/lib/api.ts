import type {
  AppInfo,
  AppSettings,
  EmbeddedBounds,
  EmbeddedSessionUpdate,
  Profile,
  ProfilePayload,
  RuntimeSession,
  RuntimeState,
  Site,
  SitePayload,
  UpdateCheckResult,
  UpdateDownloadResult,
} from './types';

function getDesktopApi() {
  if (!window.desktopApi) {
    throw new Error('桌面运行时未就绪，请使用 Electron 桌面模式启动应用');
  }
  return window.desktopApi;
}

export const api = {
  listSites: () => getDesktopApi().listSites(),
  createSite: (payload: SitePayload) => getDesktopApi().createSite(payload),
  updateSite: (payload: SitePayload) => getDesktopApi().updateSite(payload),
  deleteSite: (siteId: string) => getDesktopApi().deleteSite(siteId),
  listProfiles: (siteId: string) => getDesktopApi().listProfiles(siteId),
  listAllProfiles: () => getDesktopApi().listAllProfiles(),
  createProfile: (payload: ProfilePayload) => getDesktopApi().createProfile(payload),
  updateProfile: (payload: ProfilePayload) => getDesktopApi().updateProfile(payload),
  deleteProfile: (profileId: string, removeStorage: boolean) =>
    getDesktopApi().deleteProfile(profileId, removeStorage),
  setSitePinned: (siteId: string, pinned: boolean) =>
    getDesktopApi().setSitePinned(siteId, pinned),
  setSiteFavorite: (siteId: string, favorite: boolean) =>
    getDesktopApi().setSiteFavorite(siteId, favorite),
  setProfilePinned: (profileId: string, pinned: boolean) =>
    getDesktopApi().setProfilePinned(profileId, pinned),
  setProfileFavorite: (profileId: string, favorite: boolean) =>
    getDesktopApi().setProfileFavorite(profileId, favorite),
  listRuntimeSessions: () => getDesktopApi().listRuntimeSessions(),
  getAppInfo: (): Promise<AppInfo> => getDesktopApi().getAppInfo(),
  checkForUpdates: (): Promise<UpdateCheckResult> => getDesktopApi().checkForUpdates(),
  downloadUpdate: (downloadUrl: string, fileName?: string | null): Promise<UpdateDownloadResult> =>
    getDesktopApi().downloadUpdate(downloadUrl, fileName),
  getSettings: () => getDesktopApi().getSettings(),
  updateSettings: (settings: AppSettings) =>
    getDesktopApi().updateSettings(settings),
  openProfileEmbedded: (profileId: string, _bounds?: EmbeddedBounds) =>
    getDesktopApi().openProfileEmbedded(profileId),
  openProfileExternal: (profileId: string) =>
    getDesktopApi().openProfileExternal(profileId),
  closeProfile: (profileId: string) => getDesktopApi().closeProfile(profileId),
  clearProfileStorage: (profileId: string) =>
    getDesktopApi().clearProfileStorage(profileId),
  getProfileRuntimeState: (profileId: string) =>
    getDesktopApi().getProfileRuntimeState(profileId),
  setActiveEmbeddedProfile: (profileId: string | null) =>
    getDesktopApi().setActiveEmbeddedProfile(profileId),
  updateEmbeddedBounds: (bounds: EmbeddedBounds) =>
    getDesktopApi().updateEmbeddedBounds(bounds),
  captureEmbeddedPreview: (profileId: string) =>
    getDesktopApi().captureEmbeddedPreview(profileId),
  updateEmbeddedSessionState: (profileId: string, payload: EmbeddedSessionUpdate) =>
    getDesktopApi().updateEmbeddedSessionState(profileId, payload),
  navigateProfile: (profileId: string, url: string) =>
    getDesktopApi().navigateProfile(profileId, url),
  reloadProfile: (profileId: string) => getDesktopApi().reloadProfile(profileId),
  backProfile: (profileId: string) => getDesktopApi().backProfile(profileId),
  forwardProfile: (profileId: string) =>
    getDesktopApi().forwardProfile(profileId),
  goHomeProfile: (profileId: string) => getDesktopApi().goHomeProfile(profileId),
  openPath: (targetPath: string) => getDesktopApi().openPath(targetPath),
  showItemInFolder: (targetPath: string) => getDesktopApi().showItemInFolder(targetPath),
  openExternalUrl: (url: string) => getDesktopApi().openExternalUrl(url),
  onSessionsChanged: (callback: (sessions: RuntimeSession[]) => void) =>
    getDesktopApi().onSessionsChanged(callback),
};
