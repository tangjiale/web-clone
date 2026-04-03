import {
  AppstoreOutlined,
  CloseOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  LaptopOutlined,
  LeftOutlined,
  LinkOutlined,
  PlusOutlined,
  PushpinOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  Layout,
  List,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api';
import logoUrl from './assets/logo.svg';
import type {
  AppInfo,
  AppSettings,
  EmbeddedBounds,
  OpenMode,
  Profile,
  ProfilePayload,
  RuntimeSession,
  Site,
  SitePayload,
  UpdateCheckResult,
  UpdateDownloadResult,
} from './lib/types';

const defaultSettings: AppSettings = {
  layoutMode: 'workspace',
  defaultOpenMode: 'embedded',
  deleteProfileStorageOnRemove: false,
  lastEmbeddedProfileIds: [],
  lastActiveEmbeddedProfileId: null,
  displayVersion: '',
  updateCheckUrl: '',
};

const siteTypeOptions = [
  { label: '按域名', value: 'domain' },
  { label: '按入口 URL', value: 'entry_url' },
  { label: '站点组', value: 'group' },
];

const siteTypeLabels: Record<string, string> = {
  domain: '按域名',
  entry_url: '按入口 URL',
  group: '站点组',
};

const MANAGER_DRAWER_WIDTH = 820;
const SETTINGS_DRAWER_WIDTH = 360;

function normalizeUrlInput(value: string) {
  const input = value.trim();
  if (!input) {
    return '';
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(input)) {
    return input;
  }
  return `https://${input}`;
}

function getSiteIconCandidates(site?: Site | null) {
  if (!site) {
    return [];
  }

  const candidates: string[] = [];
  if (site.iconUrl) {
    candidates.push(site.iconUrl);
  }

  try {
    const url = new URL(site.homeUrl);
    candidates.push(`${url.origin}/favicon.ico`);
    candidates.push(`${url.origin}/favicon.png`);
    candidates.push(`${url.origin}/apple-touch-icon.png`);
    candidates.push(`${url.origin}/apple-touch-icon-precomposed.png`);
    candidates.push(`https://icons.duckduckgo.com/ip3/${url.hostname}.ico`);
    candidates.push(`https://www.google.com/s2/favicons?sz=128&domain_url=${url.origin}`);
  } catch {
    return candidates;
  }

  return [...new Set(candidates.filter(Boolean))];
}

function SiteAvatar({
  site,
  size = 32,
  fit = 'cover',
}: {
  site?: Site | null;
  size?: number;
  fit?: 'cover' | 'contain';
}) {
  const iconCandidates = useMemo(() => getSiteIconCandidates(site), [site]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const fallback = site?.name?.slice(0, 1).toUpperCase() || 'W';

  useEffect(() => {
    setCandidateIndex(0);
  }, [site?.id, site?.iconUrl, site?.homeUrl]);

  const src = iconCandidates[candidateIndex] ?? null;

  if (!src) {
    return (
      <div className="site-avatar-fallback" style={{ width: size, height: size }}>
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={site?.name ?? 'site icon'}
      width={size}
      height={size}
      className="site-avatar-image"
      style={{ objectFit: fit }}
      onError={() => setCandidateIndex((current) => current + 1)}
    />
  );
}

function App() {
  const { message } = AntApp.useApp();
  const [appInfo, setAppInfo] = useState<AppInfo>({
    appName: '网站分身管理器',
    currentVersion: '',
    displayVersion: '',
  });
  const [sites, setSites] = useState<Site[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [sessions, setSessions] = useState<RuntimeSession[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [activeEmbeddedProfileId, setActiveEmbeddedProfileId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addressValue, setAddressValue] = useState('');
  const [draggingTabProfileId, setDraggingTabProfileId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null);
  const [downloadedUpdate, setDownloadedUpdate] = useState<UpdateDownloadResult | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [embeddedPreviewUrl, setEmbeddedPreviewUrl] = useState<string | null>(null);
  const [siteModalOpen, setSiteModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [siteSearch, setSiteSearch] = useState('');
  const [siteForm] = Form.useForm<SitePayload>();
  const [profileForm] = Form.useForm<ProfilePayload>();
  const browserStageRef = useRef<HTMLDivElement | null>(null);
  const hasAutoCheckedUpdatesRef = useRef(false);

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? null,
    [sites, selectedSiteId],
  );
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const activeSession = useMemo(
    () =>
      sessions.find(
        (session) => session.profileId === activeEmbeddedProfileId && session.mode === 'embedded',
      ) ?? null,
    [activeEmbeddedProfileId, sessions],
  );
  const embeddedSessions = useMemo(() => {
    const items = sessions.filter((session) => session.mode === 'embedded');
    const order = settings.lastEmbeddedProfileIds ?? [];
    return [...items].sort((left, right) => {
      const leftIndex = order.indexOf(left.profileId);
      const rightIndex = order.indexOf(right.profileId);
      if (leftIndex === -1 && rightIndex === -1) {
        return 0;
      }
      if (leftIndex === -1) {
        return 1;
      }
      if (rightIndex === -1) {
        return -1;
      }
      return leftIndex - rightIndex;
    });
  }, [sessions, settings.lastEmbeddedProfileIds]);
  const externalSessions = useMemo(
    () => sessions.filter((session) => session.mode === 'external'),
    [sessions],
  );
  const activeHistoryState = activeSession
    ? {
        canGoBack: Boolean(activeSession.canGoBack),
        canGoForward: Boolean(activeSession.canGoForward),
      }
    : { canGoBack: false, canGoForward: false };
  const overlayOpen = drawerOpen || settingsDrawerOpen;
  const hasAvailableUpdate = updateCheckResult?.status === 'update_available';

  const refreshSites = useCallback(async () => {
    const nextSites = await api.listSites();
    setSites(nextSites);
    setSelectedSiteId((current) => {
      if (current && nextSites.some((site) => site.id === current)) {
        return current;
      }
      return nextSites[0]?.id ?? null;
    });
  }, []);

  const refreshProfiles = useCallback(async (siteId: string | null) => {
    if (!siteId) {
      setProfiles([]);
      setSelectedProfileId(null);
      return;
    }

    const nextProfiles = await api.listProfiles(siteId);
    setProfiles(nextProfiles);
    setSelectedProfileId((current) => {
      if (current && nextProfiles.some((profile) => profile.id === current)) {
        return current;
      }
      return nextProfiles[0]?.id ?? null;
    });
  }, []);

  const refreshAllProfiles = useCallback(async () => {
    const nextProfiles = await api.listAllProfiles();
    setAllProfiles(nextProfiles);
  }, []);

  const refreshAppInfo = useCallback(async () => {
    const nextAppInfo = await api.getAppInfo();
    setAppInfo(nextAppInfo);
  }, []);

  const refreshSessions = useCallback(async () => {
    const nextSessions = await api.listRuntimeSessions();
    setSessions(nextSessions);
    const visibleEmbedded =
      nextSessions.find((session) => session.mode === 'embedded' && session.visible) ??
      nextSessions.find((session) => session.mode === 'embedded') ??
      null;
    setActiveEmbeddedProfileId(visibleEmbedded?.profileId ?? null);
  }, []);

  const refreshSettings = useCallback(async () => {
    const nextSettings = await api.getSettings();
    setSettings(nextSettings);
  }, []);

  const persistSettings = useCallback(
    async (recipe: (current: AppSettings) => AppSettings) => {
      const nextSettings = recipe(settings);
      setSettings(nextSettings);
      try {
        const savedSettings = await api.updateSettings(nextSettings);
        setSettings(savedSettings);
      } catch (error) {
        message.error(String(error));
      }
    },
    [message, settings],
  );

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        refreshAppInfo(),
        refreshSites(),
        refreshSettings(),
        refreshSessions(),
        refreshAllProfiles(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [refreshAllProfiles, refreshAppInfo, refreshSessions, refreshSettings, refreshSites]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    void refreshProfiles(selectedSiteId);
  }, [refreshProfiles, selectedSiteId]);

  useEffect(() => {
    if (loading || hasAutoCheckedUpdatesRef.current) {
      return;
    }

    hasAutoCheckedUpdatesRef.current = true;
    void handleCheckForUpdates({ silent: true, openModalAfterCheck: false });
  }, [loading]);

  useEffect(() => {
    const run = async () => {
      if (!activeEmbeddedProfileId) {
        return;
      }
      await api.setActiveEmbeddedProfile(activeEmbeddedProfileId);
      await refreshSessions();
    };
    void run();
  }, [activeEmbeddedProfileId, refreshSessions]);

  useEffect(() => {
    const unlisten = api.onSessionsChanged((nextSessions) => {
      setSessions(nextSessions);
      const visibleEmbedded =
        nextSessions.find((session) => session.mode === 'embedded' && session.visible) ??
        nextSessions.find((session) => session.mode === 'embedded') ??
        null;
      setActiveEmbeddedProfileId(visibleEmbedded?.profileId ?? null);
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    setAddressValue(activeSession?.currentUrl ?? selectedSite?.homeUrl ?? '');
  }, [activeSession?.currentUrl, activeSession?.profileId, selectedSite?.homeUrl]);

  useEffect(() => {
    if (loading) {
      return;
    }
    const activeEmbeddedIds = embeddedSessions.map((session) => session.profileId);
    const currentSaved = settings.lastEmbeddedProfileIds ?? [];
    const isSame =
      activeEmbeddedIds.length === currentSaved.length &&
      activeEmbeddedIds.every((id, index) => id === currentSaved[index]);

    if (loading || isSame) {
      return;
    }

    const nextSettings = {
      ...settings,
      lastEmbeddedProfileIds: activeEmbeddedIds,
    };
    setSettings(nextSettings);
    void api.updateSettings(nextSettings).catch(() => {
      // Ignore transient persistence failures and keep local state usable.
    });
  }, [embeddedSessions, loading, settings]);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (settings.lastActiveEmbeddedProfileId === activeEmbeddedProfileId) {
      return;
    }
    const nextSettings = {
      ...settings,
      lastActiveEmbeddedProfileId: activeEmbeddedProfileId,
    };
    setSettings(nextSettings);
    void api.updateSettings(nextSettings).catch(() => {
      // Ignore transient persistence failures and keep local state usable.
    });
  }, [activeEmbeddedProfileId, loading, settings]);

  const syncEmbeddedBounds = useCallback(async () => {
    const stage = browserStageRef.current;
    const shouldHide =
      overlayOpen ||
      !activeSession ||
      activeSession.mode !== 'embedded' ||
      activeSession.loadingState === 'failed';

    const bounds: EmbeddedBounds = shouldHide || !stage
      ? { x: 0, y: 0, width: 0, height: 0 }
      : (() => {
          const rect = stage.getBoundingClientRect();
          return {
            x: Math.max(0, Math.floor(rect.left)),
            y: Math.max(0, Math.floor(rect.top)),
            width: Math.max(0, Math.floor(rect.width)),
            height: Math.max(0, Math.floor(rect.height)),
          };
        })();

    console.info('[embedded-view] sync-bounds', activeSession?.profileId ?? 'none', bounds);
    await api.updateEmbeddedBounds(bounds);
  }, [activeSession, overlayOpen]);

  useEffect(() => {
    const stage = browserStageRef.current;
    if (!stage) {
      return;
    }

    const sync = () => {
      void syncEmbeddedBounds();
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(stage);
    window.addEventListener('resize', sync);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [syncEmbeddedBounds]);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => void syncEmbeddedBounds(), 0),
      window.setTimeout(() => void syncEmbeddedBounds(), 80),
      window.setTimeout(() => void syncEmbeddedBounds(), 240),
    ];

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [activeSession?.profileId, embeddedSessions.length, overlayOpen, syncEmbeddedBounds]);

  useEffect(() => {
    if (!overlayOpen) {
      setEmbeddedPreviewUrl(null);
    }
  }, [overlayOpen]);

  const openSiteModal = (site?: Site) => {
    setEditingSite(site ?? null);
    setSiteModalOpen(true);
    siteForm.setFieldsValue({
      id: site?.id,
      name: site?.name ?? '',
      type: site?.type ?? 'domain',
      homeUrl: site?.homeUrl ?? '',
      iconUrl: site?.iconUrl ?? undefined,
      notes: site?.notes ?? '',
      targets:
        site?.targets.map((target) => ({
          targetType: target.targetType,
          value: target.value,
        })) ?? [],
    });
  };

  const openProfileModal = (profile?: Profile) => {
    if (!selectedSiteId && !profile?.siteId) {
      message.warning('请先选择一个站点');
      return;
    }
    setEditingProfile(profile ?? null);
    setProfileModalOpen(true);
    profileForm.setFieldsValue({
      id: profile?.id,
      siteId: profile?.siteId ?? selectedSiteId ?? '',
      name: profile?.name ?? '',
      notes: profile?.notes ?? '',
    });
  };

  const handleSiteSave = async () => {
    const values = await siteForm.validateFields();
    setSaving(true);
    try {
      if (editingSite) {
        await api.updateSite(values);
        message.success('站点已更新');
      } else {
        await api.createSite(values);
        message.success('站点已创建');
      }
      setSiteModalOpen(false);
      siteForm.resetFields();
      await refreshSites();
      await refreshAllProfiles();
    } catch (error) {
      message.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleProfileSave = async () => {
    const values = await profileForm.validateFields();
    setSaving(true);
    try {
      if (editingProfile) {
        await api.updateProfile(values);
        message.success('分身已更新');
      } else {
        await api.createProfile(values);
        message.success('分身已创建');
      }
      setProfileModalOpen(false);
      profileForm.resetFields();
      await refreshProfiles(values.siteId);
      await refreshAllProfiles();
    } catch (error) {
      message.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSite = async (siteId: string) => {
    try {
      await api.deleteSite(siteId);
      message.success('站点已删除');
      await refreshSites();
      await refreshAllProfiles();
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    try {
      await api.deleteProfile(profileId, settings.deleteProfileStorageOnRemove);
      message.success('分身已删除');
      await refreshProfiles(selectedSiteId);
      await refreshAllProfiles();
      await refreshSessions();
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleOpenProfile = async (profile: Profile, mode?: OpenMode) => {
    try {
      const openMode = mode ?? settings.defaultOpenMode;
      setSelectedSiteId(profile.siteId);
      setSelectedProfileId(profile.id);
      if (openMode === 'embedded') {
        setDrawerOpen(false);
        setSettingsDrawerOpen(false);
        await api.openProfileEmbedded(profile.id);
        setActiveEmbeddedProfileId(profile.id);
      } else {
        await api.openProfileExternal(profile.id);
      }
      await refreshSessions();
      await refreshProfiles(profile.siteId);
      await refreshAllProfiles();
      await syncEmbeddedBounds();
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleCloseProfile = async (profileId: string) => {
    try {
      await api.closeProfile(profileId);
      await refreshSessions();
      await refreshAllProfiles();
      await syncEmbeddedBounds();
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleClearProfileStorage = async (profileId: string) => {
    try {
      await api.clearProfileStorage(profileId);
      await refreshSessions();
      await refreshAllProfiles();
      await syncEmbeddedBounds();
      message.success('分身站点数据已清空');
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleDefaultOpenModeChange = async (value: string | number) => {
    const defaultOpenMode = value as OpenMode;
    await persistSettings((current) => ({ ...current, defaultOpenMode }));
  };

  const handleDeleteStorageToggle = async (checked: boolean) => {
    await persistSettings((current) => ({
      ...current,
      deleteProfileStorageOnRemove: checked,
    }));
  };

  const handleCheckForUpdates = async ({
    silent = false,
    openModalAfterCheck = false,
  }: {
    silent?: boolean;
    openModalAfterCheck?: boolean;
  } = {}) => {
    setCheckingUpdates(true);
    if (!silent) {
      setDownloadedUpdate(null);
    }
    try {
      const result = await api.checkForUpdates();
      setUpdateCheckResult(result);

      if (openModalAfterCheck || (!silent && result.status === 'update_available')) {
        setUpdateModalOpen(true);
      }

      if (!silent) {
        if (result.status === 'update_available') {
          message.warning(result.message);
        } else if (result.status === 'up_to_date') {
          message.success(result.message);
        } else if (result.status === 'not_configured') {
          message.warning(result.message);
        } else {
          message.error(result.message);
        }
      }
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleOpenDownloadedUpdate = async () => {
    if (!downloadedUpdate?.filePath) {
      return;
    }
    try {
      const errorMessage = await api.openPath(downloadedUpdate.filePath);
      if (errorMessage) {
        message.error(`打开安装包失败：${errorMessage}`);
        return;
      }
      message.success('安装包已打开');
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleShowDownloadedUpdate = async () => {
    if (!downloadedUpdate?.filePath) {
      return;
    }
    try {
      await api.showItemInFolder(downloadedUpdate.filePath);
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleOnlineUpdate = async () => {
    if (!updateCheckResult?.downloadUrl) {
      if (updateCheckResult?.releaseUrl) {
        await api.openExternalUrl(updateCheckResult.releaseUrl);
      } else {
        message.warning('当前没有可用的在线更新安装包');
      }
      return;
    }

    setDownloadingUpdate(true);
    try {
      const result = await api.downloadUpdate(
        updateCheckResult.downloadUrl,
        updateCheckResult.downloadFileName,
      );
      setDownloadedUpdate(result);

      if (result.status !== 'downloaded' || !result.filePath) {
        if (result.status === 'not_available') {
          message.warning(result.message);
        } else {
          message.error(result.message);
        }
        return;
      }

      const errorMessage = await api.openPath(result.filePath);
      if (errorMessage) {
        message.error(`更新包已下载，但打开失败：${errorMessage}`);
        return;
      }
      message.success('更新包已下载并打开');
    } catch (error) {
      message.error(String(error));
    } finally {
      setDownloadingUpdate(false);
    }
  };

  const handleVersionTagClick = async () => {
    if (checkingUpdates) {
      return;
    }

    if (!updateCheckResult) {
      await handleCheckForUpdates({ silent: false, openModalAfterCheck: true });
      return;
    }

    setUpdateModalOpen(true);
  };

  const handleNavigate = async (profileId: string, url: string) => {
    try {
      const session = statusByProfileId.get(profileId);
      const nextUrl = normalizeUrlInput(url);
      if (!session || !nextUrl) {
        return;
      }
      await api.navigateProfile(profileId, nextUrl);
    } catch (error) {
      message.error(String(error));
    }
  };

  const getProfileById = useCallback(
    (profileId: string) => allProfiles.find((item) => item.id === profileId) ?? null,
    [allProfiles],
  );

  const getDiagnosticForSession = useCallback(
    (session: RuntimeSession) => {
      return {
        state: session.loadingState ?? ('idle' as const),
        error: session.lastError ?? null,
      };
    },
    [],
  );

  const handleBack = async () => {
    if (!activeSession) {
      return;
    }
    await api.backProfile(activeSession.profileId);
  };

  const handleForward = async () => {
    if (!activeSession) {
      return;
    }
    await api.forwardProfile(activeSession.profileId);
  };

  const handleReload = async () => {
    if (!activeSession) {
      return;
    }
    await api.reloadProfile(activeSession.profileId);
  };

  const handleReloadSession = async (session: RuntimeSession) => {
    await api.reloadProfile(session.profileId);
  };

  const handleCopySessionAddress = async (session: RuntimeSession) => {
    const url = session.currentUrl ?? session.homeUrl;
    try {
      await navigator.clipboard.writeText(url);
      message.success('地址已复制');
    } catch {
      message.error('复制地址失败');
    }
  };

  const handleReorderTabs = useCallback(
    async (sourceProfileId: string, targetProfileId: string) => {
      if (sourceProfileId === targetProfileId) {
        return;
      }
      const currentOrder = embeddedSessions.map((session) => session.profileId);
      const sourceIndex = currentOrder.indexOf(sourceProfileId);
      const targetIndex = currentOrder.indexOf(targetProfileId);
      if (sourceIndex === -1 || targetIndex === -1) {
        return;
      }
      const nextOrder = [...currentOrder];
      const [moved] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, moved);
      await persistSettings((current) => ({
        ...current,
        lastEmbeddedProfileIds: nextOrder,
      }));
    },
    [embeddedSessions, persistSettings],
  );

  const handleGoHome = async () => {
    if (!activeSession) {
      return;
    }
    await api.goHomeProfile(activeSession.profileId);
  };

  const statusByProfileId = useMemo(() => {
    const next = new Map<string, RuntimeSession>();
    sessions.forEach((session) => next.set(session.profileId, session));
    return next;
  }, [sessions]);

  const recentProfiles = useMemo(() => {
    return [...allProfiles]
      .filter((profile) => !profile.isPinned)
      .sort((left, right) => {
        const leftPinned = left.isPinned ? 1 : 0;
        const rightPinned = right.isPinned ? 1 : 0;
        if (leftPinned !== rightPinned) {
          return rightPinned - leftPinned;
        }
        const leftFavorite = left.isFavorite ? 1 : 0;
        const rightFavorite = right.isFavorite ? 1 : 0;
        if (leftFavorite !== rightFavorite) {
          return rightFavorite - leftFavorite;
        }
        const leftTime = left.lastOpenedAt ? dayjs(left.lastOpenedAt).valueOf() : 0;
        const rightTime = right.lastOpenedAt ? dayjs(right.lastOpenedAt).valueOf() : 0;
        if (leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        return dayjs(right.updatedAt).valueOf() - dayjs(left.updatedAt).valueOf();
      })
      .slice(0, 6);
  }, [allProfiles]);

  const launchpadProfiles = useMemo(() => {
    return [...allProfiles]
      .filter((profile) => profile.isPinned)
      .sort((left, right) => {
        const leftTime = left.lastOpenedAt ? dayjs(left.lastOpenedAt).valueOf() : 0;
        const rightTime = right.lastOpenedAt ? dayjs(right.lastOpenedAt).valueOf() : 0;
        if (leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        return left.name.localeCompare(right.name, 'zh-CN');
      })
      .slice(0, 6);
  }, [allProfiles]);

  const handleToggleSitePinned = async (site: Site) => {
    try {
      await api.setSitePinned(site.id, !site.isPinned);
      await refreshSites();
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleToggleSiteFavorite = async (site: Site) => {
    try {
      await api.setSiteFavorite(site.id, !site.isFavorite);
      await refreshSites();
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleToggleProfilePinned = async (profile: Profile) => {
    try {
      await api.setProfilePinned(profile.id, !profile.isPinned);
      await refreshProfiles(profile.siteId);
      await refreshAllProfiles();
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleToggleProfileFavorite = async (profile: Profile) => {
    try {
      await api.setProfileFavorite(profile.id, !profile.isFavorite);
      await refreshProfiles(profile.siteId);
      await refreshAllProfiles();
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleCloseOtherTabs = async (keepProfileId: string) => {
    try {
      const targets = embeddedSessions
        .filter((session) => session.profileId !== keepProfileId)
        .map((session) => session.profileId);
      await Promise.all(targets.map((profileId) => api.closeProfile(profileId)));
      await refreshSessions();
      await refreshAllProfiles();
    } catch (error) {
      message.error(String(error));
    }
  };

  const filteredSites = useMemo(() => {
    const keyword = siteSearch.trim().toLowerCase();
    if (!keyword) {
      return sites;
    }

    return sites.filter((site) => {
      const haystack = [
        site.name,
        site.homeUrl,
        site.notes,
        site.targets.map((target) => target.value).join(' '),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }, [siteSearch, sites]);

  const groupedSites = useMemo(() => {
    const order = ['domain', 'entry_url', 'group'];
    return order
      .map((type) => ({
        type,
        label: siteTypeLabels[type],
        items: [...filteredSites.filter((site) => site.type === type)].sort((left, right) => {
          const pinnedDiff = Number(right.isPinned) - Number(left.isPinned);
          if (pinnedDiff !== 0) {
            return pinnedDiff;
          }
          return left.name.localeCompare(right.name, 'zh-CN');
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [filteredSites]);

  const getTabMenuItems = (session: RuntimeSession): MenuProps['items'] => [
    {
      key: 'refresh-current',
      label: '刷新标签',
    },
    {
      key: 'copy-address',
      label: '复制当前地址',
    },
    {
      key: 'close-current',
      label: '关闭当前标签',
    },
    {
      key: 'close-others',
      label: '关闭其他标签',
      disabled: embeddedSessions.length <= 1,
    },
    {
      key: 'open-external',
      label: '外置打开',
    },
  ];

  const handleTabMenuClick = async (session: RuntimeSession, key: string) => {
    if (key === 'refresh-current') {
      await handleReloadSession(session);
      return;
    }
    if (key === 'copy-address') {
      await handleCopySessionAddress(session);
      return;
    }
    if (key === 'close-current') {
      await handleCloseProfile(session.profileId);
      return;
    }
    if (key === 'close-others') {
      await handleCloseOtherTabs(session.profileId);
      return;
    }
    if (key === 'open-external') {
      const profile = allProfiles.find((item) => item.id === session.profileId);
      if (profile) {
        await handleOpenProfile(profile, 'external');
      }
    }
  };

  const orderedProfiles = useMemo(() => {
    const rank = (session?: RuntimeSession) => {
      if (session?.status === 'embedded_open') {
        return 0;
      }
      if (session?.status === 'external_open') {
        return 1;
      }
      return 2;
    };

    return [...profiles].sort((left, right) => {
      const pinnedDiff = Number(right.isPinned) - Number(left.isPinned);
      if (pinnedDiff !== 0) {
        return pinnedDiff;
      }

      const statusDiff =
        rank(statusByProfileId.get(left.id)) - rank(statusByProfileId.get(right.id));
      if (statusDiff !== 0) {
        return statusDiff;
      }

      const leftTime = left.lastOpenedAt ? dayjs(left.lastOpenedAt).valueOf() : 0;
      const rightTime = right.lastOpenedAt ? dayjs(right.lastOpenedAt).valueOf() : 0;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return dayjs(right.updatedAt).valueOf() - dayjs(left.updatedAt).valueOf();
    });
  }, [profiles, statusByProfileId]);

  const managerContent = (
    <div className="manager-center">
      <Card className="manager-hero" bordered={false}>
        <Flex justify="space-between" align="center" gap={12} wrap>
          <div className="manager-hero-copy">
            <Typography.Title level={5} style={{ margin: 0 }}>
              账号管理中心
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
              左边管理站点，右边维护对应分身，主窗口继续专注浏览。
            </Typography.Paragraph>
          </div>
          <Space size={10} wrap className="manager-stat-list">
            <div className="manager-stat-card">
              <Typography.Text type="secondary">站点</Typography.Text>
              <Typography.Text className="manager-stat-value">{sites.length}</Typography.Text>
            </div>
            <div className="manager-stat-card">
              <Typography.Text type="secondary">分身</Typography.Text>
              <Typography.Text className="manager-stat-value">{allProfiles.length}</Typography.Text>
            </div>
            <div className="manager-stat-card">
              <Typography.Text type="secondary">会话</Typography.Text>
              <Typography.Text className="manager-stat-value">{sessions.length}</Typography.Text>
            </div>
          </Space>
        </Flex>
      </Card>

      <div className="manager-grid">
        <Card
          className="manager-panel-card"
          title="站点中心"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openSiteModal()}>
              新建站点
            </Button>
          }
        >
          <Typography.Text type="secondary" className="manager-panel-subtitle">
            域名、入口 URL 与站点组都从这里统一维护。
          </Typography.Text>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索站点名称、网址、备注"
            value={siteSearch}
            onChange={(event) => setSiteSearch(event.target.value)}
          />
          <div className="site-center-list">
            {groupedSites.length ? (
              groupedSites.map((group) => (
                <div key={group.type} className="site-group-section">
                  <Flex justify="space-between" align="center" className="site-group-header">
                    <Typography.Text strong>{group.label}</Typography.Text>
                    <Tag>{group.items.length}</Tag>
                  </Flex>
                  <List
                    dataSource={group.items}
                    renderItem={(site) => (
                      <List.Item className="site-center-row">
                        <div
                          className={
                            site.id === selectedSiteId
                              ? 'site-center-card selected'
                              : 'site-center-card'
                          }
                          onClick={() => setSelectedSiteId(site.id)}
                          onDoubleClick={() => openSiteModal(site)}
                        >
                          <div className="site-center-header">
                            <Space align="start" size={12} className="site-center-head-main">
                              <div className="site-center-icon">
                                <SiteAvatar site={site} size={40} />
                              </div>
                              <div className="site-center-title-block">
                                <Space wrap size={8}>
                                  <Typography.Text strong>{site.name}</Typography.Text>
                                  {site.isPinned ? <Tag color="blue">置顶</Tag> : null}
                                  <Tag>{siteTypeLabels[site.type] ?? site.type}</Tag>
                                </Space>
                              </div>
                            </Space>
                            <Space size={4} className="manager-card-actions">
                              <Button
                                size="small"
                                icon={<EditOutlined />}
                                type="text"
                                className="manager-icon-button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openSiteModal(site);
                                }}
                              />
                              <Button
                                size="small"
                                icon={<PushpinOutlined />}
                                type="text"
                                className={site.isPinned ? 'manager-icon-button is-active' : 'manager-icon-button'}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleToggleSitePinned(site);
                                }}
                              />
                              <Popconfirm
                                title="删除站点"
                                description="删除前必须先移除该站点下的所有分身"
                                onConfirm={(event) => {
                                  event?.stopPropagation();
                                  void handleDeleteSite(site.id);
                                }}
                              >
                                <Button
                                  size="small"
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  className="manager-icon-button"
                                  onClick={(event) => event.stopPropagation()}
                                />
                              </Popconfirm>
                            </Space>
                          </div>
                          <Typography.Paragraph className="site-center-url site-center-url-wide">
                            {site.homeUrl}
                          </Typography.Paragraph>
                          <Typography.Text type="secondary" className="site-center-note">
                            {site.notes || '暂无备注'}
                          </Typography.Text>
                        </div>
                      </List.Item>
                    )}
                  />
                </div>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的站点结果" />
            )}
          </div>
        </Card>

        <Card
          className="manager-panel-card"
          title="分身中心"
          extra={
            <Button icon={<PlusOutlined />} onClick={() => openProfileModal()} disabled={!selectedSiteId}>
              新建分身
            </Button>
          }
        >
          <Typography.Text type="secondary" className="manager-panel-subtitle">
            {selectedSite
              ? `${selectedSite.name} 的分身列表`
              : '点击左侧站点后，在这里查看对应分身。'}
          </Typography.Text>

          <List
            className="profile-center-list"
            dataSource={orderedProfiles}
            locale={{
              emptyText: selectedSiteId ? '当前站点还没有分身' : '请先选择站点',
            }}
            renderItem={(profile) => {
              const session = statusByProfileId.get(profile.id);
              const statusColor =
                session?.status === 'external_open'
                  ? 'gold'
                  : session?.status === 'embedded_open'
                    ? 'blue'
                    : 'default';
              const statusText =
                session?.status === 'embedded_open'
                  ? '内嵌中'
                  : session?.status === 'external_open'
                    ? '外置中'
                    : '未打开';

              return (
                <List.Item className="profile-center-row">
                  <div
                    className={
                      profile.id === selectedProfileId
                        ? 'profile-center-card selected'
                        : 'profile-center-card'
                    }
                    onClick={() => setSelectedProfileId(profile.id)}
                    onDoubleClick={() => openProfileModal(profile)}
                  >
                    <Flex justify="space-between" align="start" gap={16} wrap>
                      <Space align="start" size={12} className="profile-center-left">
                        <div className="profile-center-main">
                        <Space wrap size={8}>
                          <Typography.Text strong>{profile.name}</Typography.Text>
                          <Tag color={statusColor}>{statusText}</Tag>
                          {profile.isPinned ? <Tag color="blue">置顶</Tag> : null}
                          {session?.mode === 'external' ? <Tag color="gold">外置模式</Tag> : null}
                        </Space>
                        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 4px' }}>
                          {profile.notes || '暂无备注'}
                        </Typography.Paragraph>
                        <Typography.Text type="secondary">
                          最近打开：
                          {profile.lastOpenedAt
                            ? dayjs(profile.lastOpenedAt).format('YYYY-MM-DD HH:mm')
                            : '从未打开'}
                        </Typography.Text>
                        <Space size={8} className="profile-card-footer" wrap>
                          <Button
                            type="primary"
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleOpenProfile(profile, 'embedded');
                            }}
                          >
                            内嵌打开
                          </Button>
                          <Button
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleOpenProfile(profile, 'external');
                            }}
                          >
                            外置打开
                          </Button>
                        </Space>
                        </div>
                      </Space>
                      <Space size={4} className="manager-card-actions">
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          type="text"
                          className="manager-icon-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openProfileModal(profile);
                          }}
                        />
                        <Button
                          icon={<PushpinOutlined />}
                          type="text"
                          className={profile.isPinned ? 'manager-icon-button is-active' : 'manager-icon-button'}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleToggleProfilePinned(profile);
                          }}
                        />
                        <Popconfirm
                          title="删除分身"
                          onConfirm={(event) => {
                            event?.stopPropagation();
                            void handleDeleteProfile(profile.id);
                          }}
                        >
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            className="manager-icon-button"
                            onClick={(event) => event.stopPropagation()}
                          />
                        </Popconfirm>
                      </Space>
                    </Flex>
                  </div>
                </List.Item>
              );
            }}
          />
        </Card>
      </div>
    </div>
  );

  const browserContent = (
    <Layout.Content className="browser-layout">
        <Card className="browser-card" styles={{ body: { padding: 0 } }}>
        <div className="browser-tabs">
          <div className="browser-tab-strip">
            {embeddedSessions.length ? (
              embeddedSessions.map((session) => (
                <Dropdown
                  key={session.profileId}
                  trigger={['contextMenu']}
                  menu={{
                    items: getTabMenuItems(session),
                    onClick: ({ key }) => void handleTabMenuClick(session, String(key)),
                  }}
                >
                  <div
                    className={
                      session.profileId === activeEmbeddedProfileId
                        ? draggingTabProfileId === session.profileId
                          ? 'browser-tab active dragging'
                          : 'browser-tab active'
                        : draggingTabProfileId === session.profileId
                          ? 'browser-tab dragging'
                          : 'browser-tab'
                    }
                    draggable
                    onClick={() => {
                      setActiveEmbeddedProfileId(session.profileId);
                      setSelectedProfileId(session.profileId);
                    }}
                    onDragStart={() => setDraggingTabProfileId(session.profileId)}
                    onDragEnd={() => setDraggingTabProfileId(null)}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggingTabProfileId) {
                        void handleReorderTabs(draggingTabProfileId, session.profileId);
                      }
                      setDraggingTabProfileId(null);
                    }}
                  >
                    <SiteAvatar
                      site={sites.find((site) => site.id === session.siteId)}
                      size={12}
                      fit="contain"
                    />
                    <span className="browser-tab-title">
                      {(sites.find((site) => site.id === session.siteId)?.name ?? '未命名站点') +
                        ' - ' +
                        session.profileName}
                    </span>
                    {session.currentUrl && session.currentUrl !== session.homeUrl ? (
                      <span className="browser-tab-dirty" title="当前标签已离开首页" />
                    ) : null}
                    <Button
                      type="text"
                      size="small"
                      className="browser-tab-close"
                      icon={<CloseOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleCloseProfile(session.profileId);
                      }}
                    />
                  </div>
                </Dropdown>
              ))
            ) : (
              <div className="browser-tab browser-tab-ghost">
                <span className="browser-tab-title">启动页</span>
              </div>
            )}
          </div>
          <Space wrap>
            {externalSessions.map((session) => (
              <Tag key={session.profileId} color="gold" className="external-session-tag">
                外置 · {session.profileName}
              </Tag>
            ))}
          </Space>
        </div>

        <Flex className="browser-action-bar" justify="space-between" align="center" gap={12}>
          <Space className="browser-nav-left" size={8}>
            <Button
              icon={<LeftOutlined />}
              className="browser-icon-button"
              disabled={!activeSession || !activeHistoryState.canGoBack}
              onClick={() => void handleBack()}
            />
            <Button
              icon={<RightOutlined />}
              className="browser-icon-button"
              disabled={!activeSession || !activeHistoryState.canGoForward}
              onClick={() => void handleForward()}
            />
            <Button
              icon={<ReloadOutlined />}
              className="browser-icon-button"
              disabled={!activeSession}
              onClick={() => void handleReload()}
            />
          </Space>

          <div className="browser-url-shell">
            <GlobalOutlined className="browser-url-icon" />
            <Input
              variant="borderless"
              className="browser-url-input"
              value={addressValue}
              disabled={!activeSession}
              placeholder="输入网址后按 Enter 访问"
              onPressEnter={(event) =>
                activeSession &&
                event.currentTarget.value.trim() &&
                void handleNavigate(activeSession.profileId, event.currentTarget.value.trim())
              }
              onChange={(event) => setAddressValue(event.target.value)}
            />
            <Button
              type="primary"
              size="small"
              disabled={!activeSession || !addressValue.trim()}
              onClick={() =>
                activeSession &&
                addressValue.trim() &&
                void handleNavigate(activeSession.profileId, addressValue)
              }
            >
              前往
            </Button>
          </div>

          <Space wrap className="browser-nav-right">
            <Button
              icon={<SwapOutlined />}
              disabled={!activeSession}
              onClick={() => void handleGoHome()}
            >
              首页
            </Button>
            <Button
              icon={<ExportOutlined />}
              disabled={!selectedProfile}
              onClick={() => selectedProfile && void handleOpenProfile(selectedProfile, 'external')}
            >
              外置打开
            </Button>
            <Button
              icon={<DeleteOutlined />}
              disabled={!activeSession}
              onClick={() => activeSession && void handleClearProfileStorage(activeSession.profileId)}
            >
              清空数据
            </Button>
            <Button
              danger
              disabled={!activeSession}
              onClick={() => activeSession && void handleCloseProfile(activeSession.profileId)}
            >
              关闭标签
            </Button>
          </Space>
        </Flex>

        <div ref={browserStageRef} className="browser-stage-wrap">
          {activeSession ? <div className="browser-embedded-host" /> : null}
          {overlayOpen && embeddedPreviewUrl ? (
            <img
              src={embeddedPreviewUrl}
              alt=""
              aria-hidden="true"
              className="browser-stage-preview"
            />
          ) : null}
          {activeSession && getDiagnosticForSession(activeSession).state === 'failed' ? (
            <div className="browser-webview-status error">
              <Typography.Title level={5}>内嵌页面加载失败</Typography.Title>
              <Typography.Paragraph type="secondary">
                {getDiagnosticForSession(activeSession).error ?? '未收到页面内容'}
              </Typography.Paragraph>
              <Space>
                <Button
                  type="primary"
                  onClick={() => {
                    const url = activeSession.currentUrl ?? activeSession.homeUrl;
                    void handleNavigate(activeSession.profileId, url);
                  }}
                >
                  重新加载
                </Button>
                <Button
                  onClick={() => {
                    const profile = getProfileById(activeSession.profileId);
                    if (profile) {
                      void handleOpenProfile(profile, 'external');
                    }
                  }}
                >
                  用外置窗口打开
                </Button>
              </Space>
            </div>
          ) : null}
          {embeddedSessions.length === 0 ? (
            <div className="browser-empty">
              <div className="browser-empty-launcher">
                <Empty description="点击右上角“站点与分身”，选择分身并内嵌打开" />
                {launchpadProfiles.length ? (
                  <div className="recent-launcher">
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      固定到启动台
                    </Typography.Title>
                    <div className="recent-launcher-grid">
                      {launchpadProfiles.map((profile) => {
                        const site = sites.find((item) => item.id === profile.siteId);
                        return (
                          <button
                            key={profile.id}
                            className="recent-launcher-card pinned"
                            onClick={() => {
                              setSelectedSiteId(profile.siteId);
                              setSelectedProfileId(profile.id);
                              void handleOpenProfile(profile, 'embedded');
                            }}
                          >
                            <Space align="start" size={12}>
                              <div className="site-center-icon">
                                <SiteAvatar site={site} size={36} />
                              </div>
                              <div className="recent-launcher-main">
                                <Space wrap size={6}>
                                  <Typography.Text strong>{profile.name}</Typography.Text>
                                  <Tag color="blue">启动台</Tag>
                                  {profile.isFavorite ? <Tag color="gold">收藏</Tag> : null}
                                </Space>
                                <Typography.Text type="secondary">
                                  {site?.name ?? '未知站点'}
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                  {profile.lastOpenedAt
                                    ? dayjs(profile.lastOpenedAt).format('YYYY-MM-DD HH:mm')
                                    : '从未打开'}
                                </Typography.Text>
                              </div>
                            </Space>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {recentProfiles.length ? (
                  <div className="recent-launcher">
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      最近使用
                    </Typography.Title>
                    <div className="recent-launcher-grid">
                      {recentProfiles.map((profile) => {
                        const site = sites.find((item) => item.id === profile.siteId);
                        return (
                          <button
                            key={profile.id}
                            className="recent-launcher-card"
                            onClick={() => {
                              setSelectedSiteId(profile.siteId);
                              setSelectedProfileId(profile.id);
                              void handleOpenProfile(profile, 'embedded');
                            }}
                          >
                            <Space align="start" size={12}>
                              <div className="site-center-icon">
                                <SiteAvatar site={site} size={36} />
                              </div>
                              <div className="recent-launcher-main">
                                <Space wrap size={6}>
                                  <Typography.Text strong>{profile.name}</Typography.Text>
                                  {profile.isPinned ? <Tag color="blue">置顶</Tag> : null}
                                  {profile.isFavorite ? <Tag color="gold">收藏</Tag> : null}
                                </Space>
                                <Typography.Text type="secondary">
                                  {site?.name ?? '未知站点'}
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                  {profile.lastOpenedAt
                                    ? dayjs(profile.lastOpenedAt).format('YYYY-MM-DD HH:mm')
                                    : '从未打开'}
                                </Typography.Text>
                              </div>
                            </Space>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </Layout.Content>
  );

  const prepareDrawerPreview = useCallback(async () => {
    if (
      overlayOpen ||
      !activeSession ||
      activeSession.mode !== 'embedded' ||
      activeSession.loadingState === 'failed'
    ) {
      return;
    }

    try {
      const preview = await api.captureEmbeddedPreview(activeSession.profileId);
      setEmbeddedPreviewUrl(preview);
    } catch {
      setEmbeddedPreviewUrl(null);
    }
  }, [activeSession, overlayOpen]);

  const openManagerDrawer = async () => {
    await prepareDrawerPreview();
    setSettingsDrawerOpen(false);
    setDrawerOpen(true);
  };

  const openSettingsDrawer = async () => {
    await prepareDrawerPreview();
    setDrawerOpen(false);
    setSettingsDrawerOpen(true);
  };

  if (loading) {
    return (
      <div className="app-loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      <Layout className="app-shell">
        <Layout.Header className="topbar">
          <Flex align="center" justify="space-between">
            <Space size={14}>
              <div className="app-logo">
                <img src={logoUrl} alt="网站分身管理器 logo" className="app-logo-image" />
              </div>
              <div className="app-branding">
                <Space size={8} className="app-branding-title">
                  <Typography.Title level={5} style={{ color: '#fff', margin: 0 }}>
                    {appInfo.appName}
                  </Typography.Title>
                  <Tag
                    color={hasAvailableUpdate ? 'error' : 'blue'}
                    className={`app-version-tag ${hasAvailableUpdate ? 'is-update-available' : ''}`}
                    onClick={() => void handleVersionTagClick()}
                  >
                    {hasAvailableUpdate
                      ? `v${appInfo.currentVersion || '0.0.0'} 有新版本`
                      : `v${appInfo.currentVersion || '0.0.0'}`}
                  </Tag>
                </Space>
                <Typography.Text className="app-branding-meta">
                  多账号隔离工作台
                </Typography.Text>
              </div>
            </Space>

            <Space size={10}>
              <Button
                ghost
                icon={<AppstoreOutlined />}
                size="middle"
                onClick={() => void openManagerDrawer()}
              >
                站点与分身
              </Button>
              <Button
                ghost
                icon={<SettingOutlined />}
                size="middle"
                onClick={() => void openSettingsDrawer()}
              />
            </Space>
          </Flex>
        </Layout.Header>

        <Layout.Content className="content-shell">{browserContent}</Layout.Content>
      </Layout>

      <Drawer
        title="站点与分身"
        placement="right"
        width={MANAGER_DRAWER_WIDTH}
        mask
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        afterOpenChange={() => void syncEmbeddedBounds()}
        styles={{ body: { padding: 0 } }}
      >
        {managerContent}
      </Drawer>

      <Drawer
        title="设置"
        placement="right"
        width={SETTINGS_DRAWER_WIDTH}
        mask
        open={settingsDrawerOpen}
        onClose={() => setSettingsDrawerOpen(false)}
        afterOpenChange={() => void syncEmbeddedBounds()}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" title="版本与更新">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space wrap>
                <Tag color="processing">v{appInfo.currentVersion || '0.0.0'}</Tag>
                <Typography.Text type="secondary">
                  更新地址由系统后台配置
                </Typography.Text>
              </Space>

              <Space wrap>
                <Button
                  type="primary"
                  loading={checkingUpdates}
                  onClick={() => void handleCheckForUpdates({ silent: false, openModalAfterCheck: true })}
                >
                  检查更新
                </Button>
                {hasAvailableUpdate ? (
                  <Button onClick={() => setUpdateModalOpen(true)}>查看新版本</Button>
                ) : null}
              </Space>

              {updateCheckResult ? (
                <Alert
                  showIcon
                  type={
                    updateCheckResult.status === 'update_available'
                      ? 'warning'
                      : updateCheckResult.status === 'error'
                        ? 'error'
                        : 'info'
                  }
                  message={updateCheckResult.message}
                  description={
                    updateCheckResult.status === 'update_available'
                      ? `发现新版本 v${updateCheckResult.latestVersion || '--'}，可点击左上角版本号查看详情。`
                      : `最近检查：${dayjs(updateCheckResult.checkedAt).format('YYYY-MM-DD HH:mm:ss')}`
                  }
                />
              ) : null}
            </Space>
          </Card>

          <Card size="small" title="默认打开方式">
            <Segmented
              block
              options={[
                { label: '内嵌浏览器', value: 'embedded' },
                { label: '外置打开', value: 'external' },
              ]}
              value={settings.defaultOpenMode}
              onChange={handleDefaultOpenModeChange}
            />
            <Typography.Paragraph
              type="secondary"
              style={{ marginBottom: 0, marginTop: 12 }}
            >
              内嵌模式优先使用主窗口浏览器区域，外置打开会以独立窗口打开同一个分身。
            </Typography.Paragraph>
          </Card>

          <Card size="small" title="删除行为">
            <Flex justify="space-between" align="center" gap={12}>
              <div>
                <Typography.Text strong>删除分身时同时清理本地站点数据</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  开启后，删除分身会一并删除它的 Cookie 和本地存储目录。
                </Typography.Paragraph>
              </div>
              <Switch
                checked={settings.deleteProfileStorageOnRemove}
                onChange={(checked) => void handleDeleteStorageToggle(checked)}
              />
            </Flex>
          </Card>
        </Space>
      </Drawer>

      <Modal
        title={hasAvailableUpdate ? '发现新版本' : '版本信息'}
        open={updateModalOpen}
        onCancel={() => setUpdateModalOpen(false)}
        footer={
          <Space wrap>
            <Button onClick={() => setUpdateModalOpen(false)}>关闭</Button>
            {updateCheckResult?.releaseUrl ? (
              <Button
                icon={<ExportOutlined />}
                onClick={() =>
                  updateCheckResult.releaseUrl &&
                  void api.openExternalUrl(updateCheckResult.releaseUrl)
                }
              >
                打开发布页
              </Button>
            ) : null}
            {hasAvailableUpdate ? (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloadingUpdate}
                onClick={() => void handleOnlineUpdate()}
              >
                在线更新
              </Button>
            ) : null}
          </Space>
        }
      >
        {updateCheckResult ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Tag>当前 v{updateCheckResult.currentVersion}</Tag>
              {updateCheckResult.latestVersion ? (
                <Tag color={hasAvailableUpdate ? 'error' : 'processing'}>
                  最新 v{updateCheckResult.latestVersion}
                </Tag>
              ) : null}
              {updateCheckResult.downloadFileName ? (
                <Tag color="purple">{updateCheckResult.downloadFileName}</Tag>
              ) : null}
            </Space>

            <Alert
              showIcon
              type={
                updateCheckResult.status === 'update_available'
                  ? 'warning'
                  : updateCheckResult.status === 'error'
                    ? 'error'
                    : 'info'
              }
              message={updateCheckResult.message}
              description={`最近检查：${dayjs(updateCheckResult.checkedAt).format('YYYY-MM-DD HH:mm:ss')}`}
            />

            {updateCheckResult.releaseNotes ? (
              <Card size="small" title="更新内容">
                <Typography.Paragraph
                  style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
                >
                  {updateCheckResult.releaseNotes}
                </Typography.Paragraph>
              </Card>
            ) : (
              <Typography.Text type="secondary">当前没有可展示的更新说明。</Typography.Text>
            )}

            {downloadedUpdate?.status === 'downloaded' && downloadedUpdate.filePath ? (
              <Card size="small" title="已下载更新包">
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Typography.Text strong>{downloadedUpdate.fileName}</Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, wordBreak: 'break-all' }}
                  >
                    {downloadedUpdate.filePath}
                  </Typography.Text>
                  <Space wrap>
                    <Button
                      size="small"
                      icon={<ExportOutlined />}
                      onClick={() => void handleOpenDownloadedUpdate()}
                    >
                      打开安装包
                    </Button>
                    <Button
                      size="small"
                      icon={<FolderOpenOutlined />}
                      onClick={() => void handleShowDownloadedUpdate()}
                    >
                      打开下载目录
                    </Button>
                  </Space>
                </Space>
              </Card>
            ) : null}
          </Space>
        ) : (
          <Empty description="还没有更新信息" />
        )}
      </Modal>

      <Modal
        title={editingSite ? '编辑站点' : '新建站点'}
        open={siteModalOpen}
        onCancel={() => setSiteModalOpen(false)}
        onOk={() => void handleSiteSave()}
        confirmLoading={saving}
      >
        <Form form={siteForm} layout="vertical" initialValues={{ type: 'domain', targets: [] }}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="name"
            label="站点名称"
            rules={[{ required: true, message: '请输入站点名称' }]}
          >
            <Input placeholder="例如：TikTok 店铺 / OA 后台" />
          </Form.Item>
          <Form.Item
            name="type"
            label="站点类型"
            rules={[{ required: true, message: '请选择站点类型' }]}
          >
            <Select options={siteTypeOptions} />
          </Form.Item>
          <Form.Item
            name="homeUrl"
            label="主页 / 登录入口"
            rules={[{ required: true, message: '请输入主页或登录入口 URL' }]}
          >
            <Input prefix={<LinkOutlined />} placeholder="https://example.com/login" />
          </Form.Item>
          <Form.List name="targets">
            {(fields, { add, remove }) => (
              <Card
                size="small"
                title="站点目标规则"
                extra={<Button onClick={() => add({ targetType: 'domain' })}>添加规则</Button>}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  {fields.length === 0 ? (
                    <Typography.Text type="secondary">
                      域名型和入口 URL 型可以不填；站点组建议补充多个目标规则
                    </Typography.Text>
                  ) : null}
                  {fields.map((field) => (
                    <Flex key={field.key} gap={8}>
                      <Form.Item
                        name={[field.name, 'targetType']}
                        style={{ flex: 1, marginBottom: 0 }}
                        rules={[{ required: true, message: '请选择规则类型' }]}
                      >
                        <Select
                          options={[
                            { label: '域名', value: 'domain' },
                            { label: '入口 URL', value: 'entry_url' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'value']}
                        style={{ flex: 2, marginBottom: 0 }}
                        rules={[{ required: true, message: '请输入规则值' }]}
                      >
                        <Input placeholder="example.com 或 https://example.com/login" />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </Flex>
                  ))}
                </Space>
              </Card>
            )}
          </Form.List>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="记录这个站点的用途、登录说明等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingProfile ? '编辑分身' : '新建分身'}
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        onOk={() => void handleProfileSave()}
        confirmLoading={saving}
      >
        <Form form={profileForm} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="siteId"
            label="所属站点"
            rules={[{ required: true, message: '请选择所属站点' }]}
          >
            <Select
              options={sites.map((site) => ({ label: site.name, value: site.id }))}
              disabled={Boolean(editingProfile)}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="分身名称"
            rules={[{ required: true, message: '请输入分身名称' }]}
          >
            <Input placeholder="例如：主号 / 客服号 / 店铺 A" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="可记录账号用途、登录说明、负责人等" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function WrappedApp() {
  return (
    <AntApp>
      <App />
    </AntApp>
  );
}
