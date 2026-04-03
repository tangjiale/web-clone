/// <reference types="vite/client" />

import type * as React from 'react';
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
} from './lib/types';

interface DesktopApi {
  listSites: () => Promise<Site[]>;
  createSite: (payload: SitePayload) => Promise<Site>;
  updateSite: (payload: SitePayload) => Promise<Site>;
  deleteSite: (siteId: string) => Promise<void>;
  listProfiles: (siteId: string) => Promise<Profile[]>;
  listAllProfiles: () => Promise<Profile[]>;
  createProfile: (payload: ProfilePayload) => Promise<Profile>;
  updateProfile: (payload: ProfilePayload) => Promise<Profile>;
  deleteProfile: (profileId: string, removeStorage: boolean) => Promise<void>;
  setSitePinned: (siteId: string, pinned: boolean) => Promise<Site>;
  setSiteFavorite: (siteId: string, favorite: boolean) => Promise<Site>;
  setProfilePinned: (profileId: string, pinned: boolean) => Promise<Profile>;
  setProfileFavorite: (profileId: string, favorite: boolean) => Promise<Profile>;
  listRuntimeSessions: () => Promise<RuntimeSession[]>;
  getAppInfo: () => Promise<AppInfo>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: (
    downloadUrl: string,
    fileName?: string | null,
  ) => Promise<UpdateDownloadResult>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: AppSettings) => Promise<AppSettings>;
  openProfileEmbedded: (profileId: string, bounds?: EmbeddedBounds) => Promise<RuntimeSession>;
  openProfileExternal: (profileId: string) => Promise<RuntimeSession>;
  closeProfile: (profileId: string) => Promise<void>;
  clearProfileStorage: (profileId: string) => Promise<void>;
  getProfileRuntimeState: (profileId: string) => Promise<RuntimeState>;
  setActiveEmbeddedProfile: (profileId: string | null) => Promise<void>;
  updateEmbeddedBounds: (bounds: EmbeddedBounds) => Promise<void>;
  captureEmbeddedPreview: (profileId: string) => Promise<string | null>;
  updateEmbeddedSessionState: (
    profileId: string,
    payload: EmbeddedSessionUpdate,
  ) => Promise<RuntimeState>;
  navigateProfile: (profileId: string, url: string) => Promise<void>;
  reloadProfile: (profileId: string) => Promise<void>;
  backProfile: (profileId: string) => Promise<void>;
  forwardProfile: (profileId: string) => Promise<void>;
  goHomeProfile: (profileId: string) => Promise<void>;
  openPath: (targetPath: string) => Promise<string>;
  showItemInFolder: (targetPath: string) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  onSessionsChanged: (callback: (sessions: RuntimeSession[]) => void) => () => void;
}

interface ElectronWebviewTag extends HTMLElement {
  src: string;
  partition: string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  loadURL: (url: string) => void;
  getURL: () => string;
}

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<ElectronWebviewTag>,
        ElectronWebviewTag
      > & {
        src?: string;
        partition?: string;
        allowpopups?: boolean | string;
        useragent?: string;
        autosize?: boolean | string;
      };
    }
  }
}
