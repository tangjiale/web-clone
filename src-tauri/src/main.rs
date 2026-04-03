#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Mutex,
};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, Webview,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri::webview::WebviewBuilder;
use tauri_plugin_sql::{Migration, MigrationKind};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SiteTarget {
    id: String,
    site_id: String,
    target_type: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Site {
    id: String,
    name: String,
    #[serde(rename = "type")]
    site_type: String,
    home_url: String,
    icon_url: Option<String>,
    notes: String,
    is_pinned: bool,
    is_favorite: bool,
    targets: Vec<SiteTarget>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: String,
    site_id: String,
    name: String,
    notes: String,
    storage_key: String,
    is_pinned: bool,
    is_favorite: bool,
    last_opened_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    layout_mode: String,
    default_open_mode: String,
    delete_profile_storage_on_remove: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            layout_mode: "workspace".into(),
            default_open_mode: "embedded".into(),
            delete_profile_storage_on_remove: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SitePayload {
    id: Option<String>,
    name: String,
    #[serde(rename = "type")]
    site_type: String,
    home_url: String,
    icon_url: Option<String>,
    notes: Option<String>,
    targets: Vec<SiteTargetPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SiteTargetPayload {
    target_type: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfilePayload {
    id: Option<String>,
    site_id: String,
    name: String,
    notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSession {
    profile_id: String,
    site_id: String,
    profile_name: String,
    mode: String,
    status: String,
    window_label: String,
    webview_label: String,
    current_url: Option<String>,
    home_url: String,
    visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStateView {
    profile_id: String,
    status: String,
    current_url: Option<String>,
    mode: Option<String>,
}

#[derive(Debug, Clone)]
struct RuntimeRegistry {
    sessions: HashMap<String, RuntimeSession>,
    active_embedded_profile_id: Option<String>,
}

impl Default for RuntimeRegistry {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
            active_embedded_profile_id: None,
        }
    }
}

struct AppState {
    db_path: PathBuf,
    profiles_root: PathBuf,
    runtime: Mutex<RuntimeRegistry>,
}

#[derive(Debug, Clone)]
struct ProfileWithSite {
    profile: Profile,
    site: Site,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn open_connection(state: &AppState) -> Result<Connection, String> {
    Connection::open(&state.db_path).map_err(|error| error.to_string())
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
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
              delete_profile_storage_on_remove INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )
        .map_err(|error| error.to_string())?;

    ensure_column(connection, "sites", "is_pinned INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(connection, "sites", "is_favorite INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(connection, "profiles", "is_pinned INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(connection, "profiles", "is_favorite INTEGER NOT NULL DEFAULT 0")?;

    connection
        .execute(
            r#"
            INSERT INTO app_settings (id, layout_mode, default_open_mode, delete_profile_storage_on_remove)
            VALUES (1, 'workspace', 'embedded', 0)
            ON CONFLICT(id) DO NOTHING
            "#,
            [],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn ensure_column(connection: &Connection, table: &str, column_definition: &str) -> Result<(), String> {
    let sql = format!("ALTER TABLE {table} ADD COLUMN {column_definition}");
    match connection.execute(&sql, []) {
        Ok(_) => Ok(()),
        Err(error) => {
            let message = error.to_string();
            if message.contains("duplicate column name") {
                Ok(())
            } else {
                Err(message)
            }
        }
    }
}

fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

fn site_targets(connection: &Connection, site_id: &str) -> Result<Vec<SiteTarget>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, site_id, target_type, value FROM site_targets WHERE site_id = ? ORDER BY rowid",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([site_id], |row| {
            Ok(SiteTarget {
                id: row.get(0)?,
                site_id: row.get(1)?,
                target_type: row.get(2)?,
                value: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn list_sites_inner(connection: &Connection) -> Result<Vec<Site>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, type, home_url, icon_url, notes, is_pinned, is_favorite, created_at, updated_at
             FROM sites
             ORDER BY is_pinned DESC, is_favorite DESC, updated_at DESC, name ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(Site {
                id: row.get(0)?,
                name: row.get(1)?,
                site_type: row.get(2)?,
                home_url: row.get(3)?,
                icon_url: row.get(4)?,
                notes: row.get(5)?,
                is_pinned: row.get::<_, i64>(6)? == 1,
                is_favorite: row.get::<_, i64>(7)? == 1,
                targets: Vec::new(),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut sites = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    for site in &mut sites {
        site.targets = site_targets(connection, &site.id)?;
    }

    Ok(sites)
}

fn list_profiles_inner(connection: &Connection, site_id: &str) -> Result<Vec<Profile>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, site_id, name, notes, storage_key, is_pinned, is_favorite, last_opened_at, created_at, updated_at
             FROM profiles WHERE site_id = ?
             ORDER BY is_pinned DESC, is_favorite DESC, updated_at DESC, name ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([site_id], |row| {
            Ok(Profile {
                id: row.get(0)?,
                site_id: row.get(1)?,
                name: row.get(2)?,
                notes: row.get(3)?,
                storage_key: row.get(4)?,
                is_pinned: row.get::<_, i64>(5)? == 1,
                is_favorite: row.get::<_, i64>(6)? == 1,
                last_opened_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn list_all_profiles_inner(connection: &Connection) -> Result<Vec<Profile>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, site_id, name, notes, storage_key, is_pinned, is_favorite, last_opened_at, created_at, updated_at
             FROM profiles
             ORDER BY is_pinned DESC, is_favorite DESC, COALESCE(last_opened_at, '') DESC, updated_at DESC, name ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(Profile {
                id: row.get(0)?,
                site_id: row.get(1)?,
                name: row.get(2)?,
                notes: row.get(3)?,
                storage_key: row.get(4)?,
                is_pinned: row.get::<_, i64>(5)? == 1,
                is_favorite: row.get::<_, i64>(6)? == 1,
                last_opened_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_profile_with_site(connection: &Connection, profile_id: &str) -> Result<ProfileWithSite, String> {
    let profile = connection
        .query_row(
            "SELECT id, site_id, name, notes, storage_key, is_pinned, is_favorite, last_opened_at, created_at, updated_at
             FROM profiles WHERE id = ?",
            [profile_id],
            |row| {
                Ok(Profile {
                    id: row.get(0)?,
                    site_id: row.get(1)?,
                    name: row.get(2)?,
                    notes: row.get(3)?,
                    storage_key: row.get(4)?,
                    is_pinned: row.get::<_, i64>(5)? == 1,
                    is_favorite: row.get::<_, i64>(6)? == 1,
                    last_opened_at: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "未找到分身".to_string())?;

    let mut site = connection
        .query_row(
            "SELECT id, name, type, home_url, icon_url, notes, is_pinned, is_favorite, created_at, updated_at
             FROM sites WHERE id = ?",
            [profile.site_id.clone()],
            |row| {
                Ok(Site {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    site_type: row.get(2)?,
                    home_url: row.get(3)?,
                    icon_url: row.get(4)?,
                    notes: row.get(5)?,
                    is_pinned: row.get::<_, i64>(6)? == 1,
                    is_favorite: row.get::<_, i64>(7)? == 1,
                    targets: Vec::new(),
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "分身所属站点不存在".to_string())?;

    site.targets = site_targets(connection, &site.id)?;

    Ok(ProfileWithSite { profile, site })
}

fn current_settings(connection: &Connection) -> Result<AppSettings, String> {
    connection
        .query_row(
            "SELECT layout_mode, default_open_mode, delete_profile_storage_on_remove
             FROM app_settings WHERE id = 1",
            [],
            |row| {
                Ok(AppSettings {
                    layout_mode: row.get(0)?,
                    default_open_mode: row.get(1)?,
                    delete_profile_storage_on_remove: row.get::<_, i64>(2)? == 1,
                })
            },
        )
        .map_err(|error| error.to_string())
}

fn profile_storage_paths(state: &AppState, storage_key: &str) -> (PathBuf, [u8; 16]) {
    let profile_dir = state.profiles_root.join(storage_key);
    let digest = Sha256::digest(storage_key.as_bytes());
    let mut identifier = [0_u8; 16];
    identifier.copy_from_slice(&digest[..16]);
    (profile_dir, identifier)
}

fn emit_sessions(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let sessions = {
        let runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
        runtime.sessions.values().cloned().collect::<Vec<_>>()
    };
    app.emit("runtime://sessions-changed", sessions)
        .map_err(|error| error.to_string())
}

fn update_profile_last_opened(connection: &Connection, profile_id: &str) -> Result<(), String> {
    let now = now_iso();
    connection
        .execute(
            "UPDATE profiles SET last_opened_at = ?, updated_at = ? WHERE id = ?",
            params![now, now, profile_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn configure_child_webview<R: Runtime>(
    builder: WebviewBuilder<R>,
    profile: &ProfileWithSite,
    state: &AppState,
) -> Result<WebviewBuilder<R>, String> {
    let (profile_dir, data_store_identifier) = profile_storage_paths(state, &profile.profile.storage_key);
    fs::create_dir_all(&profile_dir).map_err(|error| error.to_string())?;
    let builder = builder.auto_resize().focused(true);

    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(data_store_identifier);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(profile_dir);

    Ok(builder)
}

fn configure_window_builder<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
    profile: &ProfileWithSite,
    state: &AppState,
) -> Result<WebviewWindowBuilder<'a, R, M>, String> {
    let (profile_dir, data_store_identifier) = profile_storage_paths(state, &profile.profile.storage_key);
    fs::create_dir_all(&profile_dir).map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(data_store_identifier);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(profile_dir);

    Ok(builder
        .title(format!("{} · {}", profile.site.name, profile.profile.name))
        .inner_size(1320.0, 900.0)
        .resizable(true))
}

#[cfg(target_os = "macos")]
fn resolve_embedded_window_bounds(
    main_window: &WebviewWindow,
    bounds: &EmbeddedBounds,
) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
    let position = main_window
        .inner_position()
        .map_err(|error| error.to_string())?;
    Ok((
        PhysicalPosition::new(position.x + bounds.x, position.y + bounds.y),
        PhysicalSize::new(bounds.width, bounds.height),
    ))
}

fn set_embedded_visibility(
    app: &AppHandle,
    state: &AppState,
    active_profile_id: Option<&str>,
) -> Result<(), String> {
    let mut runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
    runtime.active_embedded_profile_id = active_profile_id.map(ToString::to_string);
    for session in runtime.sessions.values_mut() {
        if session.mode != "embedded" {
            continue;
        }
        let is_visible = active_profile_id.is_some_and(|profile_id| profile_id == session.profile_id);
        if let Some(window) = app.get_webview_window(&session.window_label) {
            if session.window_label != "main" {
                if is_visible {
                    window.show().map_err(|error| error.to_string())?;
                    window.set_focus().map_err(|error| error.to_string())?;
                } else {
                    window.hide().map_err(|error| error.to_string())?;
                }
                session.visible = is_visible;
                continue;
            }
        }
        if let Some(webview) = app.get_webview(&session.webview_label) {
            if is_visible {
                webview.show().map_err(|error| error.to_string())?;
                webview.set_focus().map_err(|error| error.to_string())?;
            } else {
                webview.hide().map_err(|error| error.to_string())?;
            }
        }
        session.visible = is_visible;
    }
    drop(runtime);
    emit_sessions(app, state)
}

fn ensure_session_alive(
    app: &AppHandle,
    state: &AppState,
    profile_id: &str,
) -> Result<Option<RuntimeSession>, String> {
    let existing = {
        let runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
        runtime.sessions.get(profile_id).cloned()
    };

    let Some(session) = existing else {
        return Ok(None);
    };

    let alive = if session.mode == "external" {
        app.get_webview_window(&session.window_label).is_some()
    } else {
        app.get_webview(&session.webview_label).is_some()
    };

    if alive {
        return Ok(Some(session));
    }

    let mut runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
    runtime.sessions.remove(profile_id);
    drop(runtime);
    emit_sessions(app, state)?;
    Ok(None)
}

fn session_labels(profile_id: &str) -> (String, String) {
    (
        format!("profile-{profile_id}-webview"),
        format!("profile-{profile_id}-window"),
    )
}

fn build_runtime_session(profile: &ProfileWithSite, mode: &str, window_label: String, webview_label: String) -> RuntimeSession {
    RuntimeSession {
        profile_id: profile.profile.id.clone(),
        site_id: profile.site.id.clone(),
        profile_name: profile.profile.name.clone(),
        mode: mode.to_string(),
        status: if mode == "embedded" {
            "embedded_open".into()
        } else {
            "external_open".into()
        },
        window_label,
        webview_label,
        current_url: Some(normalize_url(&profile.site.home_url)),
        home_url: normalize_url(&profile.site.home_url),
        visible: mode == "embedded",
    }
}

#[tauri::command]
fn list_sites(state: State<'_, AppState>) -> Result<Vec<Site>, String> {
    let connection = open_connection(&state)?;
    list_sites_inner(&connection)
}

#[tauri::command]
fn create_site(state: State<'_, AppState>, payload: SitePayload) -> Result<Site, String> {
    let connection = open_connection(&state)?;
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    connection
        .execute(
            "INSERT INTO sites (id, name, type, home_url, icon_url, notes, is_pinned, is_favorite, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
            params![
                id,
                payload.name.trim(),
                payload.site_type,
                normalize_url(&payload.home_url),
                payload.icon_url,
                payload.notes.unwrap_or_default(),
                now,
                now
            ],
        )
        .map_err(|error| error.to_string())?;

    for target in payload.targets {
        connection
            .execute(
                "INSERT INTO site_targets (id, site_id, target_type, value) VALUES (?, ?, ?, ?)",
                params![
                    Uuid::new_v4().to_string(),
                    id,
                    target.target_type,
                    target.value.trim()
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    list_sites_inner(&connection)?
        .into_iter()
        .find(|site| site.id == id)
        .ok_or_else(|| "创建站点失败".to_string())
}

#[tauri::command]
fn update_site(state: State<'_, AppState>, payload: SitePayload) -> Result<Site, String> {
    let site_id = payload.id.clone().ok_or_else(|| "站点 ID 缺失".to_string())?;
    let connection = open_connection(&state)?;
    let now = now_iso();
    connection
        .execute(
            "UPDATE sites SET name = ?, type = ?, home_url = ?, icon_url = ?, notes = ?, updated_at = ?
             WHERE id = ?",
            params![
                payload.name.trim(),
                payload.site_type,
                normalize_url(&payload.home_url),
                payload.icon_url,
                payload.notes.unwrap_or_default(),
                now,
                site_id
            ],
        )
        .map_err(|error| error.to_string())?;

    connection
        .execute("DELETE FROM site_targets WHERE site_id = ?", [site_id.clone()])
        .map_err(|error| error.to_string())?;

    for target in payload.targets {
        connection
            .execute(
                "INSERT INTO site_targets (id, site_id, target_type, value) VALUES (?, ?, ?, ?)",
                params![
                    Uuid::new_v4().to_string(),
                    site_id,
                    target.target_type,
                    target.value.trim()
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    list_sites_inner(&connection)?
        .into_iter()
        .find(|site| site.id == site_id)
        .ok_or_else(|| "更新站点失败".to_string())
}

#[tauri::command]
fn delete_site(state: State<'_, AppState>, site_id: String) -> Result<(), String> {
    let connection = open_connection(&state)?;
    let profiles_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM profiles WHERE site_id = ?",
            [site_id.clone()],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    if profiles_count > 0 {
        return Err("请先删除该站点下的所有分身".into());
    }

    connection
        .execute("DELETE FROM site_targets WHERE site_id = ?", [site_id.clone()])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM sites WHERE id = ?", [site_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_profiles(state: State<'_, AppState>, site_id: String) -> Result<Vec<Profile>, String> {
    let connection = open_connection(&state)?;
    list_profiles_inner(&connection, &site_id)
}

#[tauri::command]
fn list_all_profiles(state: State<'_, AppState>) -> Result<Vec<Profile>, String> {
    let connection = open_connection(&state)?;
    list_all_profiles_inner(&connection)
}

fn site_by_id(connection: &Connection, site_id: &str) -> Result<Site, String> {
    list_sites_inner(connection)?
        .into_iter()
        .find(|site| site.id == site_id)
        .ok_or_else(|| "未找到站点".to_string())
}

fn profile_by_id(connection: &Connection, profile_id: &str) -> Result<Profile, String> {
    list_all_profiles_inner(connection)?
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "未找到分身".to_string())
}

#[tauri::command]
fn set_site_pinned(state: State<'_, AppState>, site_id: String, pinned: bool) -> Result<Site, String> {
    let connection = open_connection(&state)?;
    connection
        .execute(
            "UPDATE sites SET is_pinned = ?, updated_at = ? WHERE id = ?",
            params![i64::from(pinned), now_iso(), site_id],
        )
        .map_err(|error| error.to_string())?;
    site_by_id(&connection, &site_id)
}

#[tauri::command]
fn set_site_favorite(state: State<'_, AppState>, site_id: String, favorite: bool) -> Result<Site, String> {
    let connection = open_connection(&state)?;
    connection
        .execute(
            "UPDATE sites SET is_favorite = ?, updated_at = ? WHERE id = ?",
            params![i64::from(favorite), now_iso(), site_id],
        )
        .map_err(|error| error.to_string())?;
    site_by_id(&connection, &site_id)
}

#[tauri::command]
fn create_profile(state: State<'_, AppState>, payload: ProfilePayload) -> Result<Profile, String> {
    let connection = open_connection(&state)?;
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let storage_key = format!("profile-{}", Uuid::new_v4());

    connection
        .execute(
            "INSERT INTO profiles (id, site_id, name, notes, storage_key, is_pinned, is_favorite, last_opened_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, 0, NULL, ?, ?)",
            params![
                id,
                payload.site_id,
                payload.name.trim(),
                payload.notes.unwrap_or_default(),
                storage_key,
                now,
                now
            ],
        )
        .map_err(|error| error.to_string())?;

    list_profiles_inner(&connection, &payload.site_id)?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| "创建分身失败".to_string())
}

#[tauri::command]
fn update_profile(state: State<'_, AppState>, payload: ProfilePayload) -> Result<Profile, String> {
    let profile_id = payload.id.clone().ok_or_else(|| "分身 ID 缺失".to_string())?;
    let connection = open_connection(&state)?;
    let now = now_iso();

    connection
        .execute(
            "UPDATE profiles SET name = ?, notes = ?, updated_at = ? WHERE id = ?",
            params![payload.name.trim(), payload.notes.unwrap_or_default(), now, profile_id],
        )
        .map_err(|error| error.to_string())?;

    list_profiles_inner(&connection, &payload.site_id)?
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "更新分身失败".to_string())
}

#[tauri::command]
fn set_profile_pinned(
    state: State<'_, AppState>,
    profile_id: String,
    pinned: bool,
) -> Result<Profile, String> {
    let connection = open_connection(&state)?;
    connection
        .execute(
            "UPDATE profiles SET is_pinned = ?, updated_at = ? WHERE id = ?",
            params![i64::from(pinned), now_iso(), profile_id],
        )
        .map_err(|error| error.to_string())?;
    profile_by_id(&connection, &profile_id)
}

#[tauri::command]
fn set_profile_favorite(
    state: State<'_, AppState>,
    profile_id: String,
    favorite: bool,
) -> Result<Profile, String> {
    let connection = open_connection(&state)?;
    connection
        .execute(
            "UPDATE profiles SET is_favorite = ?, updated_at = ? WHERE id = ?",
            params![i64::from(favorite), now_iso(), profile_id],
        )
        .map_err(|error| error.to_string())?;
    profile_by_id(&connection, &profile_id)
}

#[tauri::command]
fn delete_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    remove_storage: bool,
) -> Result<(), String> {
    let connection = open_connection(&state)?;
    let profile = load_profile_with_site(&connection, &profile_id)?;
    close_profile(app, state.clone(), profile_id.clone())?;
    connection
        .execute("DELETE FROM profiles WHERE id = ?", [profile_id])
        .map_err(|error| error.to_string())?;

    if remove_storage {
        let (profile_dir, _) = profile_storage_paths(&state, &profile.profile.storage_key);
        if profile_dir.exists() {
            fs::remove_dir_all(profile_dir).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let connection = open_connection(&state)?;
    current_settings(&connection)
}

#[tauri::command]
fn update_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<AppSettings, String> {
    let connection = open_connection(&state)?;
    connection
        .execute(
            "UPDATE app_settings SET layout_mode = ?, default_open_mode = ?, delete_profile_storage_on_remove = ? WHERE id = 1",
            params![
                settings.layout_mode,
                settings.default_open_mode,
                i64::from(settings.delete_profile_storage_on_remove)
            ],
        )
        .map_err(|error| error.to_string())?;
    current_settings(&connection)
}

#[tauri::command]
fn list_runtime_sessions(state: State<'_, AppState>) -> Result<Vec<RuntimeSession>, String> {
    let runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
    Ok(runtime.sessions.values().cloned().collect())
}

#[tauri::command]
fn get_profile_runtime_state(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<RuntimeStateView, String> {
    let runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
    let session = runtime.sessions.get(&profile_id);
    Ok(RuntimeStateView {
        profile_id,
        status: session
            .map(|value| value.status.clone())
            .unwrap_or_else(|| "idle".to_string()),
        current_url: session.and_then(|value| value.current_url.clone()),
        mode: session.map(|value| value.mode.clone()),
    })
}

#[tauri::command]
fn open_profile_embedded(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    bounds: EmbeddedBounds,
) -> Result<RuntimeSession, String> {
    if let Some(existing) = ensure_session_alive(&app, &state, &profile_id)? {
        if existing.mode == "embedded" {
            update_embedded_bounds(app.clone(), state.clone(), bounds.clone())?;
            set_embedded_visibility(&app, &state, Some(&profile_id))?;
            return Ok(existing);
        }
        if let Some(window) = app.get_webview_window(&existing.window_label) {
            window.set_focus().map_err(|error| error.to_string())?;
        }
        return Ok(existing);
    }

    let connection = open_connection(&state)?;
    let profile = load_profile_with_site(&connection, &profile_id)?;
    update_profile_last_opened(&connection, &profile_id)?;
    let (webview_label, window_label) = session_labels(&profile.profile.id);
    #[cfg(target_os = "macos")]
    {
        let main_window = app
            .get_webview_window("main")
            .ok_or_else(|| "主窗口不存在".to_string())?;
        let (position, size) = resolve_embedded_window_bounds(&main_window, &bounds)?;
        let page_load_profile_id = profile.profile.id.clone();
        let builder = configure_window_builder(
            WebviewWindowBuilder::new(
                &app,
                &window_label,
                WebviewUrl::External(
                    normalize_url(&profile.site.home_url)
                        .parse()
                        .map_err(|error: url::ParseError| error.to_string())?,
                ),
            ),
            &profile,
            &state,
        )?
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .position(f64::from(position.x), f64::from(position.y))
        .inner_size(f64::from(size.width), f64::from(size.height))
        .parent(&main_window)
        .map_err(|error| error.to_string())?
        .on_page_load(move |webview, payload| {
            let app_handle = webview.app_handle();
            let state = app_handle.state::<AppState>();
            if let Ok(mut runtime) = state.runtime.lock() {
                if let Some(session) = runtime.sessions.get_mut(&page_load_profile_id) {
                    session.current_url = Some(payload.url().to_string());
                }
            }
            let _ = emit_sessions(&app_handle, &state);
        });

        let window = builder.build().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        let runtime_session =
            build_runtime_session(&profile, "embedded", window_label.clone(), window_label.clone());
        {
            let mut runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
            runtime
                .sessions
                .insert(profile.profile.id.clone(), runtime_session.clone());
        }
        set_embedded_visibility(&app, &state, Some(&profile.profile.id))?;
        return Ok(runtime_session);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let main_window = app
            .get_window("main")
            .ok_or_else(|| "主窗口不存在".to_string())?;

        let page_load_profile_id = profile.profile.id.clone();
        let builder = configure_child_webview(
            WebviewBuilder::new(
                webview_label.clone(),
                WebviewUrl::External(
                    normalize_url(&profile.site.home_url)
                        .parse()
                        .map_err(|error: url::ParseError| error.to_string())?,
                ),
            ),
            &profile,
            &state,
        )?;
        let builder = builder.on_page_load(move |webview, payload| {
            let app_handle = webview.app_handle();
            let state = app_handle.state::<AppState>();
            if let Ok(mut runtime) = state.runtime.lock() {
                if let Some(session) = runtime.sessions.get_mut(&page_load_profile_id) {
                    session.current_url = Some(payload.url().to_string());
                }
            }
            let _ = emit_sessions(&app_handle, &state);
        });

        let child = main_window
            .add_child(
                builder,
                PhysicalPosition::new(bounds.x, bounds.y),
                PhysicalSize::new(bounds.width, bounds.height),
            )
            .map_err(|error| error.to_string())?;
        child
            .set_auto_resize(true)
            .map_err(|error| error.to_string())?;
        child
            .set_bounds(tauri::Rect {
                position: PhysicalPosition::new(bounds.x, bounds.y).into(),
                size: PhysicalSize::new(bounds.width, bounds.height).into(),
            })
            .map_err(|error| error.to_string())?;
        child.show().map_err(|error| error.to_string())?;
        child.set_focus().map_err(|error| error.to_string())?;

        let runtime_session = build_runtime_session(&profile, "embedded", window_label, webview_label);
        {
            let mut runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
            runtime
                .sessions
                .insert(profile.profile.id.clone(), runtime_session.clone());
        }
        set_embedded_visibility(&app, &state, Some(&profile.profile.id))?;
        Ok(runtime_session)
    }
}

#[tauri::command]
fn open_profile_external(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<RuntimeSession, String> {
    if let Some(existing) = ensure_session_alive(&app, &state, &profile_id)? {
        if existing.mode == "external" {
            if let Some(window) = app.get_webview_window(&existing.window_label) {
                window.set_focus().map_err(|error| error.to_string())?;
            }
            return Ok(existing);
        }
        return Ok(existing);
    }

    let connection = open_connection(&state)?;
    let profile = load_profile_with_site(&connection, &profile_id)?;
    update_profile_last_opened(&connection, &profile_id)?;
    let target_url = normalize_url(&profile.site.home_url);
    let (webview_label, window_label) = session_labels(&profile.profile.id);

    let builder = configure_window_builder(
        WebviewWindowBuilder::new(
            &app,
            &window_label,
            WebviewUrl::External(
                target_url
                    .parse()
                    .map_err(|error: url::ParseError| error.to_string())?,
            ),
        ),
        &profile,
        &state,
    )?;

    let page_load_profile_id = profile.profile.id.clone();
    let builder = builder.on_page_load(move |webview, payload| {
        let app_handle = webview.app_handle();
        let state = app_handle.state::<AppState>();
        if let Ok(mut runtime) = state.runtime.lock() {
            if let Some(session) = runtime.sessions.get_mut(&page_load_profile_id) {
                session.current_url = Some(payload.url().to_string());
            }
        }
        let _ = emit_sessions(&app_handle, &state);
    });

    let window = builder.build().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    let runtime_session =
        build_runtime_session(&profile, "external", window_label.clone(), webview_label);

    {
        let mut runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
        runtime
            .sessions
            .insert(profile.profile.id.clone(), runtime_session.clone());
    }
    emit_sessions(&app, &state)?;
    Ok(runtime_session)
}

#[tauri::command]
fn close_profile(app: AppHandle, state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    let session = {
        let mut runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
        runtime.sessions.remove(&profile_id)
    };

    if let Some(session) = session {
        if session.mode == "external" {
            if let Some(window) = app.get_webview_window(&session.window_label) {
                window.close().map_err(|error| error.to_string())?;
            }
        } else if let Some(window) = app.get_webview_window(&session.window_label) {
            if session.window_label != "main" {
                window.close().map_err(|error| error.to_string())?;
            } else if let Some(webview) = app.get_webview(&session.webview_label) {
                webview.close().map_err(|error| error.to_string())?;
            }
        } else if let Some(webview) = app.get_webview(&session.webview_label) {
            webview.close().map_err(|error| error.to_string())?;
        }
    }

    let fallback_active = {
        let runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
        runtime
            .sessions
            .values()
            .find(|session| session.mode == "embedded")
            .map(|session| session.profile_id.clone())
    };
    set_embedded_visibility(&app, &state, fallback_active.as_deref())?;
    emit_sessions(&app, &state)
}

#[tauri::command]
fn clear_profile_storage(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    let connection = open_connection(&state)?;
    let profile = load_profile_with_site(&connection, &profile_id)?;
    close_profile(app, state.clone(), profile_id)?;
    let (profile_dir, _) = profile_storage_paths(&state, &profile.profile.storage_key);
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&profile_dir).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_active_embedded_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<(), String> {
    set_embedded_visibility(&app, &state, profile_id.as_deref())
}

#[tauri::command]
fn update_embedded_bounds(
    app: AppHandle,
    state: State<'_, AppState>,
    bounds: EmbeddedBounds,
) -> Result<(), String> {
    let runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
    let labels = runtime
        .sessions
        .values()
        .filter(|session| session.mode == "embedded")
        .map(|session| (session.window_label.clone(), session.webview_label.clone()))
        .collect::<Vec<_>>();
    drop(runtime);

    #[cfg(target_os = "macos")]
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;

    for (window_label, webview_label) in labels {
        #[cfg(target_os = "macos")]
        {
            if let Some(window) = app.get_webview_window(&window_label) {
                if window_label != "main" {
                    let (position, size) = resolve_embedded_window_bounds(&main_window, &bounds)?;
                    window
                        .set_position(position)
                        .map_err(|error| error.to_string())?;
                    window.set_size(size).map_err(|error| error.to_string())?;
                    continue;
                }
            }
        }
        if let Some(webview) = app.get_webview(&webview_label) {
            webview
                .set_bounds(tauri::Rect {
                    position: PhysicalPosition::new(bounds.x, bounds.y).into(),
                    size: PhysicalSize::new(bounds.width, bounds.height).into(),
                })
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn with_live_session<F>(
    app: &AppHandle,
    state: &AppState,
    profile_id: &str,
    action: F,
) -> Result<(), String>
where
    F: FnOnce(&WebviewWindow, Option<&Webview>) -> Result<(), String>,
{
    let session = ensure_session_alive(app, state, profile_id)?
        .ok_or_else(|| "分身尚未打开".to_string())?;

    if session.mode == "external" {
        let window = app
            .get_webview_window(&session.window_label)
            .ok_or_else(|| "外置窗口不存在".to_string())?;
        action(&window, None)
    } else {
        if let Some(window) = app.get_webview_window(&session.window_label) {
            if session.window_label != "main" {
                return action(&window, None);
            }
        }
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "主窗口不存在".to_string())?;
        let webview = app
            .get_webview(&session.webview_label)
            .ok_or_else(|| "内嵌浏览器不存在".to_string())?;
        action(&window, Some(&webview))
    }
}

#[tauri::command]
fn navigate_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    url: String,
) -> Result<(), String> {
    let normalized_url = normalize_url(&url);
    let url_for_action = normalized_url.clone();
    with_live_session(&app, &state, &profile_id, move |window, webview| {
        let parsed_url = url_for_action
            .parse()
            .map_err(|error: url::ParseError| error.to_string())?;
        if let Some(webview) = webview {
            webview.navigate(parsed_url).map_err(|error| error.to_string())
        } else {
            window.navigate(parsed_url).map_err(|error| error.to_string())
        }
    })?;
    {
        let mut runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
        if let Some(session) = runtime.sessions.get_mut(&profile_id) {
            session.current_url = Some(normalized_url.clone());
        }
    }
    emit_sessions(&app, &state)
}

#[tauri::command]
fn reload_profile(app: AppHandle, state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    with_live_session(&app, &state, &profile_id, |window, webview| {
        if let Some(webview) = webview {
            webview.reload().map_err(|error| error.to_string())
        } else {
            window.reload().map_err(|error| error.to_string())
        }
    })
}

#[tauri::command]
fn back_profile(app: AppHandle, state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    with_live_session(&app, &state, &profile_id, |window, webview| {
        if let Some(webview) = webview {
            webview
                .eval("window.history.back();")
                .map_err(|error| error.to_string())
        } else {
            window
                .eval("window.history.back();")
                .map_err(|error| error.to_string())
        }
    })
}

#[tauri::command]
fn forward_profile(app: AppHandle, state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    with_live_session(&app, &state, &profile_id, |window, webview| {
        if let Some(webview) = webview {
            webview
                .eval("window.history.forward();")
                .map_err(|error| error.to_string())
        } else {
            window
                .eval("window.history.forward();")
                .map_err(|error| error.to_string())
        }
    })
}

#[tauri::command]
fn go_home_profile(app: AppHandle, state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    let home_url = {
        let runtime = state.runtime.lock().map_err(|_| "运行时锁已损坏")?;
        runtime
            .sessions
            .get(&profile_id)
            .map(|session| session.home_url.clone())
            .unwrap_or_default()
    };
    navigate_profile(app, state, profile_id, home_url)
}

fn app_state(app: &AppHandle) -> Result<AppState, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let db_path = data_dir.join("web-clone.sqlite3");
    let profiles_root = data_dir.join("profiles");
    fs::create_dir_all(&profiles_root).map_err(|error| error.to_string())?;
    let connection = Connection::open(&db_path).map_err(|error| error.to_string())?;
    initialize_schema(&connection)?;
    Ok(AppState {
        db_path,
        profiles_root,
        runtime: Mutex::new(RuntimeRegistry::default()),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:web-clone.sqlite3",
                    vec![Migration {
                        version: 1,
                        description: "initialize database",
                        sql: "SELECT 1",
                        kind: MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .setup(|app| {
            let state = app_state(&app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_sites,
            create_site,
            update_site,
            delete_site,
            list_profiles,
            list_all_profiles,
            create_profile,
            update_profile,
            set_site_pinned,
            set_site_favorite,
            set_profile_pinned,
            set_profile_favorite,
            delete_profile,
            get_settings,
            update_settings,
            list_runtime_sessions,
            get_profile_runtime_state,
            open_profile_embedded,
            open_profile_external,
            close_profile,
            clear_profile_storage,
            set_active_embedded_profile,
            update_embedded_bounds,
            navigate_profile,
            reload_profile,
            back_profile,
            forward_profile,
            go_home_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
