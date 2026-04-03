export type SiteType = 'domain' | 'entry_url' | 'group';
export type LayoutMode = 'workspace' | 'split-page' | 'tabbed';
export type OpenMode = 'embedded' | 'external';
export type ProfileStatus = 'idle' | 'embedded_open' | 'external_open';

export interface SiteTarget {
  id: string;
  siteId: string;
  targetType: 'domain' | 'entry_url';
  value: string;
}

export interface Site {
  id: string;
  name: string;
  type: SiteType;
  homeUrl: string;
  iconUrl: string | null;
  notes: string;
  isPinned: boolean;
  isFavorite: boolean;
  targets: SiteTarget[];
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  siteId: string;
  name: string;
  notes: string;
  storageKey: string;
  isPinned: boolean;
  isFavorite: boolean;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  layoutMode: LayoutMode;
  defaultOpenMode: OpenMode;
  deleteProfileStorageOnRemove: boolean;
  lastEmbeddedProfileIds: string[];
  lastActiveEmbeddedProfileId: string | null;
  displayVersion: string;
  updateCheckUrl: string;
}

export interface AppInfo {
  appName: string;
  currentVersion: string;
  displayVersion: string;
}

export interface UpdateCheckResult {
  status: 'not_configured' | 'up_to_date' | 'update_available' | 'error';
  currentVersion: string;
  displayVersion: string;
  latestVersion: string | null;
  checkedAt: string;
  sourceUrl: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  downloadUrl: string | null;
  downloadFileName: string | null;
  message: string;
}

export interface UpdateDownloadResult {
  status: 'downloaded' | 'not_available' | 'error';
  filePath: string | null;
  fileName: string | null;
  downloadsDir: string | null;
  sourceUrl: string | null;
  message: string;
}

export interface RuntimeSession {
  profileId: string;
  siteId: string;
  profileName: string;
  mode: OpenMode;
  status: ProfileStatus;
  windowLabel: string;
  webviewLabel: string;
  currentUrl: string | null;
  homeUrl: string;
  visible: boolean;
  storagePartition: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  loadingState?: 'idle' | 'loading' | 'ready' | 'failed';
  lastError?: string | null;
}

export interface RuntimeState {
  profileId: string;
  status: ProfileStatus;
  currentUrl: string | null;
  mode: OpenMode | null;
}

export interface EmbeddedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbeddedSessionUpdate {
  currentUrl?: string | null;
  visible?: boolean;
  loadingState?: 'idle' | 'loading' | 'ready' | 'failed';
  lastError?: string | null;
}

export interface SitePayload {
  id?: string;
  name: string;
  type: SiteType;
  homeUrl: string;
  iconUrl?: string | null;
  notes?: string;
  targets: Array<{
    targetType: 'domain' | 'entry_url';
    value: string;
  }>;
}

export interface ProfilePayload {
  id?: string;
  siteId: string;
  name: string;
  notes?: string;
}
