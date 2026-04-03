const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function nowIso() {
  return new Date().toISOString();
}

function normalizeUrl(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(input)) {
    return input;
  }
  return `https://${input}`;
}

function ensureColumn(db, table, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function mapSiteTarget(row) {
  return {
    id: row.id,
    siteId: row.site_id,
    targetType: row.target_type,
    value: row.value,
  };
}

function createDatabase({ userData }) {
  const dataDir = path.join(userData, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'web-clone.sqlite3');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      home_url TEXT NOT NULL,
      icon_url TEXT,
      notes TEXT NOT NULL DEFAULT '',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_targets (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      value TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      storage_key TEXT NOT NULL UNIQUE,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      layout_mode TEXT NOT NULL,
      default_open_mode TEXT NOT NULL,
      delete_profile_storage_on_remove INTEGER NOT NULL DEFAULT 0,
      last_embedded_profile_ids TEXT NOT NULL DEFAULT '[]',
      last_active_embedded_profile_id TEXT,
      display_version TEXT NOT NULL DEFAULT '',
      update_check_url TEXT NOT NULL DEFAULT ''
    );
  `);

  ensureColumn(db, 'sites', 'is_pinned', 'is_pinned INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'sites', 'is_favorite', 'is_favorite INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'profiles', 'is_pinned', 'is_pinned INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'profiles', 'is_favorite', 'is_favorite INTEGER NOT NULL DEFAULT 0');
  ensureColumn(
    db,
    'app_settings',
    'last_embedded_profile_ids',
    `last_embedded_profile_ids TEXT NOT NULL DEFAULT '[]'`,
  );
  ensureColumn(
    db,
    'app_settings',
    'last_active_embedded_profile_id',
    'last_active_embedded_profile_id TEXT',
  );
  ensureColumn(
    db,
    'app_settings',
    'display_version',
    `display_version TEXT NOT NULL DEFAULT ''`,
  );
  ensureColumn(
    db,
    'app_settings',
    'update_check_url',
    `update_check_url TEXT NOT NULL DEFAULT ''`,
  );

  db.prepare(`
    INSERT INTO app_settings (
      id,
      layout_mode,
      default_open_mode,
      delete_profile_storage_on_remove,
      last_embedded_profile_ids,
      last_active_embedded_profile_id,
      display_version,
      update_check_url
    )
    VALUES (1, 'workspace', 'embedded', 0, '[]', NULL, '', '')
    ON CONFLICT(id) DO NOTHING
  `).run();

  function parseJsonArray(value) {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  const getSiteTargetsStatement = db.prepare(`
    SELECT id, site_id, target_type, value
    FROM site_targets
    WHERE site_id = ?
    ORDER BY rowid ASC
  `);

  function mapSite(row) {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      homeUrl: row.home_url,
      iconUrl: row.icon_url,
      notes: row.notes,
      isPinned: Boolean(row.is_pinned),
      isFavorite: Boolean(row.is_favorite),
      targets: getSiteTargetsStatement.all(row.id).map(mapSiteTarget),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapProfile(row) {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      siteId: row.site_id,
      name: row.name,
      notes: row.notes,
      storageKey: row.storage_key,
      isPinned: Boolean(row.is_pinned),
      isFavorite: Boolean(row.is_favorite),
      lastOpenedAt: row.last_opened_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  const listSitesStatement = db.prepare(`
    SELECT id, name, type, home_url, icon_url, notes, is_pinned, is_favorite, created_at, updated_at
    FROM sites
    ORDER BY is_pinned DESC, is_favorite DESC, updated_at DESC, created_at DESC
  `);

  const getSiteStatement = db.prepare(`
    SELECT id, name, type, home_url, icon_url, notes, is_pinned, is_favorite, created_at, updated_at
    FROM sites
    WHERE id = ?
  `);

  const listProfilesStatement = db.prepare(`
    SELECT id, site_id, name, notes, storage_key, is_pinned, is_favorite, last_opened_at, created_at, updated_at
    FROM profiles
    WHERE site_id = ?
    ORDER BY is_pinned DESC, is_favorite DESC, COALESCE(last_opened_at, '') DESC, updated_at DESC
  `);

  const listAllProfilesStatement = db.prepare(`
    SELECT id, site_id, name, notes, storage_key, is_pinned, is_favorite, last_opened_at, created_at, updated_at
    FROM profiles
    ORDER BY is_pinned DESC, is_favorite DESC, COALESCE(last_opened_at, '') DESC, updated_at DESC
  `);

  const getProfileStatement = db.prepare(`
    SELECT id, site_id, name, notes, storage_key, is_pinned, is_favorite, last_opened_at, created_at, updated_at
    FROM profiles
    WHERE id = ?
  `);

  const createSiteTxn = db.transaction((payload) => {
    const siteId = payload.id || crypto.randomUUID();
    const now = nowIso();
    db.prepare(`
      INSERT INTO sites (id, name, type, home_url, icon_url, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      siteId,
      payload.name.trim(),
      payload.type,
      normalizeUrl(payload.homeUrl),
      payload.iconUrl || null,
      payload.notes?.trim() || '',
      now,
      now,
    );

    for (const target of payload.targets || []) {
      db.prepare(`
        INSERT INTO site_targets (id, site_id, target_type, value)
        VALUES (?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        siteId,
        target.targetType,
        normalizeUrl(target.value),
      );
    }

    return mapSite(getSiteStatement.get(siteId));
  });

  const updateSiteTxn = db.transaction((payload) => {
    const current = getSiteStatement.get(payload.id);
    if (!current) {
      throw new Error('站点不存在');
    }

    db.prepare(`
      UPDATE sites
      SET name = ?, type = ?, home_url = ?, icon_url = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.name.trim(),
      payload.type,
      normalizeUrl(payload.homeUrl),
      payload.iconUrl || null,
      payload.notes?.trim() || '',
      nowIso(),
      payload.id,
    );

    db.prepare(`DELETE FROM site_targets WHERE site_id = ?`).run(payload.id);
    for (const target of payload.targets || []) {
      db.prepare(`
        INSERT INTO site_targets (id, site_id, target_type, value)
        VALUES (?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        payload.id,
        target.targetType,
        normalizeUrl(target.value),
      );
    }

    return mapSite(getSiteStatement.get(payload.id));
  });

  const createProfileTxn = db.transaction((payload) => {
    const site = getSiteStatement.get(payload.siteId);
    if (!site) {
      throw new Error('站点不存在');
    }

    const profileId = payload.id || crypto.randomUUID();
    const now = nowIso();
    const storageKey = crypto
      .createHash('sha256')
      .update(`${payload.siteId}:${payload.name}:${profileId}:${now}`)
      .digest('hex')
      .slice(0, 24);

    db.prepare(`
      INSERT INTO profiles (id, site_id, name, notes, storage_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      profileId,
      payload.siteId,
      payload.name.trim(),
      payload.notes?.trim() || '',
      storageKey,
      now,
      now,
    );

    return mapProfile(getProfileStatement.get(profileId));
  });

  const updateProfileTxn = db.transaction((payload) => {
    const current = getProfileStatement.get(payload.id);
    if (!current) {
      throw new Error('分身不存在');
    }
    const site = getSiteStatement.get(payload.siteId);
    if (!site) {
      throw new Error('站点不存在');
    }

    db.prepare(`
      UPDATE profiles
      SET site_id = ?, name = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.siteId,
      payload.name.trim(),
      payload.notes?.trim() || '',
      nowIso(),
      payload.id,
    );

    return mapProfile(getProfileStatement.get(payload.id));
  });

  return {
    dbPath,
    listSites() {
      return listSitesStatement.all().map(mapSite);
    },
    getSite(siteId) {
      return mapSite(getSiteStatement.get(siteId));
    },
    createSite(payload) {
      return createSiteTxn(payload);
    },
    updateSite(payload) {
      return updateSiteTxn(payload);
    },
    deleteSite(siteId) {
      const profileCount = db.prepare(`SELECT COUNT(*) AS count FROM profiles WHERE site_id = ?`).get(siteId)
        .count;
      if (profileCount > 0) {
        throw new Error('请先删除该站点下的所有分身');
      }
      db.prepare(`DELETE FROM sites WHERE id = ?`).run(siteId);
    },
    listProfiles(siteId) {
      return listProfilesStatement.all(siteId).map(mapProfile);
    },
    listAllProfiles() {
      return listAllProfilesStatement.all().map(mapProfile);
    },
    getProfile(profileId) {
      return mapProfile(getProfileStatement.get(profileId));
    },
    createProfile(payload) {
      return createProfileTxn(payload);
    },
    updateProfile(payload) {
      return updateProfileTxn(payload);
    },
    deleteProfile(profileId) {
      db.prepare(`DELETE FROM profiles WHERE id = ?`).run(profileId);
    },
    setSitePinned(siteId, pinned) {
      db.prepare(`UPDATE sites SET is_pinned = ?, updated_at = ? WHERE id = ?`).run(
        pinned ? 1 : 0,
        nowIso(),
        siteId,
      );
      return mapSite(getSiteStatement.get(siteId));
    },
    setSiteFavorite(siteId, favorite) {
      db.prepare(`UPDATE sites SET is_favorite = ?, updated_at = ? WHERE id = ?`).run(
        favorite ? 1 : 0,
        nowIso(),
        siteId,
      );
      return mapSite(getSiteStatement.get(siteId));
    },
    setProfilePinned(profileId, pinned) {
      db.prepare(`UPDATE profiles SET is_pinned = ?, updated_at = ? WHERE id = ?`).run(
        pinned ? 1 : 0,
        nowIso(),
        profileId,
      );
      return mapProfile(getProfileStatement.get(profileId));
    },
    setProfileFavorite(profileId, favorite) {
      db.prepare(`UPDATE profiles SET is_favorite = ?, updated_at = ? WHERE id = ?`).run(
        favorite ? 1 : 0,
        nowIso(),
        profileId,
      );
      return mapProfile(getProfileStatement.get(profileId));
    },
    markProfileOpened(profileId) {
      db.prepare(`UPDATE profiles SET last_opened_at = ?, updated_at = ? WHERE id = ?`).run(
        nowIso(),
        nowIso(),
        profileId,
      );
      return mapProfile(getProfileStatement.get(profileId));
    },
    getSettings() {
      const row = db.prepare(`
        SELECT
          layout_mode,
          default_open_mode,
          delete_profile_storage_on_remove,
          last_embedded_profile_ids,
          last_active_embedded_profile_id,
          display_version,
          update_check_url
        FROM app_settings
        WHERE id = 1
      `).get();

      return {
        layoutMode: row?.layout_mode || 'workspace',
        defaultOpenMode: row?.default_open_mode || 'embedded',
        deleteProfileStorageOnRemove: Boolean(row?.delete_profile_storage_on_remove),
        lastEmbeddedProfileIds: parseJsonArray(row?.last_embedded_profile_ids),
        lastActiveEmbeddedProfileId: row?.last_active_embedded_profile_id || null,
        displayVersion: row?.display_version || '',
        updateCheckUrl: row?.update_check_url || '',
      };
    },
    updateSettings(settings) {
      db.prepare(`
        UPDATE app_settings
        SET
          layout_mode = ?,
          default_open_mode = ?,
          delete_profile_storage_on_remove = ?,
          last_embedded_profile_ids = ?,
          last_active_embedded_profile_id = ?,
          display_version = ?,
          update_check_url = ?
        WHERE id = 1
      `).run(
        settings.layoutMode,
        settings.defaultOpenMode,
        settings.deleteProfileStorageOnRemove ? 1 : 0,
        JSON.stringify(settings.lastEmbeddedProfileIds || []),
        settings.lastActiveEmbeddedProfileId || null,
        String(settings.displayVersion || '').trim(),
        String(settings.updateCheckUrl || '').trim(),
      );
      return this.getSettings();
    },
    getProfileBundle(profileId) {
      const profile = mapProfile(getProfileStatement.get(profileId));
      if (!profile) {
        return null;
      }
      const site = this.getSite(profile.siteId);
      if (!site) {
        return null;
      }
      return { profile, site };
    },
    close() {
      db.close();
    },
  };
}

module.exports = {
  createDatabase,
  normalizeUrl,
};
