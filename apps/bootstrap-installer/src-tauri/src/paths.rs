//! Filesystem paths + logging setup.
//!
//! Mirrors `lemon_constants.get_lemon_home()` from the Python CLI:
//!   Windows: %LOCALAPPDATA%\Lemon AI
//!   macOS:   ~/.lemon-ai
//!   Linux:   ~/.lemon-ai  (override via $LEMON_HOME)
//!
//! NOTE (macOS): Python's get_lemon_home(), scripts/install.sh, and the
//! Electron desktop's resolveLemonHome() ALL use ~/.lemon-ai on macOS — there
//! is no ~/Library/Application Support branch anywhere else. An earlier
//! version of this file used Application Support, which drifted from every
//! other component: the installer wrote the install to one dir and the
//! desktop looked for it in another, so first launch never found the backend.
//!
//! IMPORTANT: this must match exactly. Drift here means install.ps1
//! writes to one place and the installer reads from another, breaking
//! the bootstrap-complete check.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use tracing_appender::non_blocking::WorkerGuard;

pub fn internal_desktop_build() -> bool {
    internal_desktop_build_for(
        std::env::var("LEMON_DESKTOP_INTERNAL").ok().as_deref(),
        std::env::var("LEMON_DESKTOP_HARNESS_CONFIG")
            .ok()
            .as_deref(),
        std::env::var("LEMON_DESKTOP_HARNESS_CONFIG")
            .ok()
            .as_deref(),
        option_env!("LEMON_INSTALLER_BRAND"),
    )
}

fn truthy_env(value: Option<&str>) -> bool {
    matches!(
        value.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

fn installer_brand_is_internal(brand: Option<&str>) -> bool {
    matches!(brand.map(str::trim), Some(value) if value.eq_ignore_ascii_case("lemon"))
}

fn internal_desktop_build_for(
    explicit_internal: Option<&str>,
    lemon_harness_config: Option<&str>,
    legacy_harness_config: Option<&str>,
    compiled_brand: Option<&str>,
) -> bool {
    if truthy_env(explicit_internal) || installer_brand_is_internal(compiled_brand) {
        return true;
    }

    lemon_harness_config
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| legacy_harness_config.map(str::trim).filter(|value| !value.is_empty()))
        .map(|value| valid_internal_harness_config(Path::new(value)))
        .unwrap_or(false)
}

fn valid_internal_harness_config(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    let Some(ui) = value.get("ui").and_then(|ui| ui.as_object()) else {
        return false;
    };
    const UI_KEYS: [&str; 5] = ["agents", "cron", "messaging", "terminal", "webhooks"];
    value.get("schemaVersion").and_then(|v| v.as_i64()) == Some(1)
        && value.get("profile").and_then(|v| v.as_str()) == Some("internal")
        && ui.len() == UI_KEYS.len()
        && UI_KEYS
            .iter()
            .all(|key| ui.get(*key).and_then(|v| v.as_bool()).is_some())
}

fn safe_file_name(value: Option<&str>, fallback: &str) -> String {
    value
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && *value != "."
                && *value != ".."
                && !value.contains("..")
                && !value.contains('/')
                && !value.contains('\\')
        })
        .unwrap_or(fallback)
        .to_string()
}

fn safe_file_name_from_env(key: &str, fallback: &str) -> String {
    safe_file_name(std::env::var(key).ok().as_deref(), fallback)
}

fn default_runtime_dir_name(internal: bool) -> &'static str {
    if internal {
        "lemon-agent"
    } else {
        "lemon-agent"
    }
}

fn fallback_home_dir_name(internal: bool) -> &'static str {
    if internal {
        ".lemon-ai"
    } else {
        ".lemon-ai"
    }
}

fn runtime_dir_name_for(
    internal: bool,
    desktop_override: Option<&str>,
    legacy_override: Option<&str>,
) -> String {
    let selected = if internal {
        desktop_override
    } else {
        legacy_override
    };
    safe_file_name(selected, default_runtime_dir_name(internal))
}

pub fn runtime_dir_name() -> String {
    let internal = internal_desktop_build();
    runtime_dir_name_for(
        internal,
        std::env::var("LEMON_DESKTOP_RUNTIME_DIR_NAME")
            .ok()
            .as_deref(),
        std::env::var("LEMON_INSTALL_RUNTIME_DIR_NAME")
            .ok()
            .as_deref(),
    )
}

/// Returns the canonical Lemon AI home directory, respecting $LEMON_HOME if set.
pub fn lemon_home() -> PathBuf {
    let internal = internal_desktop_build();

    if let Some(override_path) = home_override_for(
        internal,
        std::env::var("LEMON_DESKTOP_HOME_OVERRIDE")
            .ok()
            .as_deref(),
        std::env::var("LEMON_HOME").ok().as_deref(),
    ) {
        return override_path;
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = dirs::data_local_dir() {
            if internal {
                return local_app_data.join("Lemon AI");
            }
            return local_app_data.join("lemon");
        }
    }

    if let Some(home) = dirs::home_dir() {
        if internal {
            return home.join(".lemon-ai");
        }
        return home.join(".lemon-ai");
    }

    // Last resort — current dir, almost certainly wrong but at least
    // doesn't panic.
    PathBuf::from(fallback_home_dir_name(internal))
}

fn home_override_for(
    internal: bool,
    desktop_override: Option<&str>,
    legacy_override: Option<&str>,
) -> Option<PathBuf> {
    let desktop = desktop_override
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(value) = desktop {
        return Some(PathBuf::from(value));
    }

    if internal {
        return None;
    }

    legacy_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn install_root_for_home_with_runtime(
    home: &Path,
    runtime_dir_name: &str,
    _internal: bool,
) -> PathBuf {
    home.join(runtime_dir_name)
}

pub fn install_root_for_home(home: &Path) -> PathBuf {
    install_root_for_home_with_runtime(home, &runtime_dir_name(), internal_desktop_build())
}

pub fn install_root() -> PathBuf {
    let home = lemon_home();
    install_root_for_home(&home)
}

pub fn log_dir() -> PathBuf {
    lemon_home().join("logs")
}

pub fn log_path() -> PathBuf {
    log_dir().join("bootstrap-installer.log")
}

pub fn bootstrap_cache_dir() -> PathBuf {
    lemon_home().join("bootstrap-cache")
}

fn product_name_for(internal: bool) -> &'static str {
    if internal {
        "Lemon AI"
    } else {
        "Lemon AI"
    }
}

pub fn product_name() -> &'static str {
    product_name_for(internal_desktop_build())
}

pub(crate) fn update_temp_prefix(internal: bool) -> &'static str {
    if internal {
        "lemon-ai-update"
    } else {
        "lemon-update"
    }
}

fn update_result_name(internal: bool) -> &'static str {
    if internal {
        ".lemon-ai-update-result.json"
    } else {
        ".lemon-ai-update-result.json"
    }
}

fn desktop_identity_child_env_for(
    internal: bool,
    runtime_dir_name: String,
    bootstrap_marker_name: String,
    update_marker_name: String,
    product_name: &'static str,
) -> Vec<(&'static str, OsString)> {
    let runtime_dir_name = OsString::from(runtime_dir_name);
    let mut envs = vec![
        ("LEMON_INSTALL_RUNTIME_DIR_NAME", runtime_dir_name.clone()),
        (
            "LEMON_BOOTSTRAP_MARKER_NAME",
            OsString::from(bootstrap_marker_name),
        ),
        (
            "LEMON_UPDATE_MARKER_NAME",
            OsString::from(update_marker_name),
        ),
        ("LEMON_UPDATE_PRODUCT_NAME", OsString::from(product_name)),
        (
            "LEMON_UPDATE_TEMP_PREFIX",
            OsString::from(update_temp_prefix(internal)),
        ),
        (
            "LEMON_UPDATE_RESULT_NAME",
            OsString::from(update_result_name(internal)),
        ),
    ];
    if internal {
        envs.push(("LEMON_DESKTOP_RUNTIME_DIR_NAME", runtime_dir_name));
        envs.push(("LEMON_DESKTOP_INTERNAL", OsString::from("1")));
    }
    envs
}

pub(crate) fn desktop_identity_child_env() -> Vec<(&'static str, OsString)> {
    let internal = internal_desktop_build();

    desktop_identity_child_env_for(
        internal,
        runtime_dir_name(),
        safe_file_name_from_env(
            "LEMON_BOOTSTRAP_MARKER_NAME",
            default_bootstrap_marker_name(internal),
        ),
        safe_file_name_from_env(
            "LEMON_UPDATE_MARKER_NAME",
            default_update_marker_name(internal),
        ),
        product_name_for(internal),
    )
}

#[tauri::command]
pub fn get_product_name() -> String {
    product_name().to_string()
}

/// Stable location the installer copies itself to after a successful install.
/// The desktop app re-invokes this with `--update`, and the start-menu /
/// desktop shortcuts can point users back to it. Lives directly under
/// LEMON_HOME so it survives repo checkout deletion (unlike anything under
/// lemon-agent/).
///
/// On Windows this is `%LOCALAPPDATA%\Lemon AI\lemon-setup.exe`; on other
/// platforms the extension differs but the directory is the same.
pub fn installer_dest() -> PathBuf {
    let fallback = if cfg!(target_os = "windows") {
        if internal_desktop_build() {
            "lemon-ai-setup.exe"
        } else {
            "lemon-setup.exe"
        }
    } else {
        if internal_desktop_build() {
            "lemon-ai-setup"
        } else {
            "lemon-setup"
        }
    };
    let name = safe_file_name_from_env("LEMON_STAGED_UPDATER_NAME", fallback);
    lemon_home().join(name)
}

/// Marker the updater writes for the duration of an in-app update and removes
/// when it finishes (see update.rs `UpdateMarkerGuard`). A freshly-launched
/// desktop checks this before spawning its own local backend: spawning one
/// mid-update re-locks the venv shim and triggers `force_kill_other_lemon`,
/// which then kills that legitimate backend in a respawn loop (#50238).
///
/// Lives directly under LEMON_HOME (same rationale as `installer_dest`) so the
/// Electron desktop — which resolves LEMON_HOME identically and pins it into
/// the updater's env — agrees on the exact path.
fn default_update_marker_name(internal: bool) -> &'static str {
    if internal {
        ".lemon-ai-update-in-progress"
    } else {
        ".lemon-ai-update-in-progress"
    }
}

pub fn update_marker_name() -> String {
    safe_file_name_from_env(
        "LEMON_UPDATE_MARKER_NAME",
        default_update_marker_name(internal_desktop_build()),
    )
}

pub fn update_in_progress_marker() -> PathBuf {
    lemon_home().join(update_marker_name())
}

/// Copy the currently-running installer binary to `installer_dest()` so it's
/// available for future `--update` runs and shortcut launches.
///
/// No-ops (returns Ok) when the running exe is ALREADY the destination — which
/// is exactly the case during an `--update` run (the desktop launched us FROM
/// that path), where copying onto ourselves would be a Windows sharing
/// violation. Best-effort: a failure here must not fail the install, so the
/// caller logs and continues.
///
/// NOTE: because of that no-op, a user's staged installer is only ever written
/// by a full install/repair. Every later `--update` runs the ORIGINAL binary,
/// so an installer-protocol change can strand the whole installed base on a
/// binary that predates it (see `restage_from_checkout`, which repairs this
/// from the freshly-updated checkout).
pub fn copy_self_to_lemon_home() -> std::io::Result<()> {
    let src = std::env::current_exe()?;
    let dest = installer_dest();

    // Skip if we're already running from the destination (update re-invocation
    // or a prior copy). canonicalize both so symlinks / 8.3 short paths / case
    // differences don't trick us into a self-copy.
    let same = match (src.canonicalize(), dest.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => src == dest,
    };
    if same {
        tracing::info!(
            ?dest,
            "installer already at destination; skipping self-copy"
        );
        return Ok(());
    }

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(&src, &dest)?;
    repair_macos_installer_helper(&dest);
    tracing::info!(?src, ?dest, "copied installer to LEMON_HOME");
    Ok(())
}

#[cfg(target_os = "macos")]
fn repair_macos_installer_helper(path: &Path) {
    // The staged helper may inherit quarantine from the downloaded installer.
    // Desktop later launches this exact file for in-app updates, so make it
    // executable before the update handoff reaches LaunchServices/Gatekeeper.
    let _ = Command::new("/usr/bin/xattr")
        .args(["-cr"])
        .arg(path)
        .status();

    let verify = Command::new("/usr/bin/codesign")
        .arg("--verify")
        .arg(path)
        .status();

    if !matches!(verify, Ok(status) if status.success()) {
        let _ = Command::new("/usr/bin/codesign")
            .args(["--force", "--sign", "-"])
            .arg(path)
            .status();
    }
}

#[cfg(not(target_os = "macos"))]
fn repair_macos_installer_helper(_path: &Path) {}

/// Where the bootstrap-complete marker lives (existence-only for the Rust
/// installer fast path; JSON schema-checked by the Electron app). Per main.ts:
///   const BOOTSTRAP_COMPLETE_MARKER = path.join(ACTIVE_LEMON_ROOT, '.lemon-ai-bootstrap-complete')
/// We don't always know ACTIVE_LEMON_ROOT until install.ps1 reports it, so
/// this is a probe helper, not a definitive path.
fn default_bootstrap_marker_name(internal: bool) -> &'static str {
    if internal {
        ".lemon-ai-bootstrap-complete"
    } else {
        ".lemon-ai-bootstrap-complete"
    }
}

pub fn bootstrap_marker_name() -> String {
    safe_file_name_from_env(
        "LEMON_BOOTSTRAP_MARKER_NAME",
        default_bootstrap_marker_name(internal_desktop_build()),
    )
}

pub fn likely_bootstrap_marker(install_root: &Path) -> PathBuf {
    install_root.join(bootstrap_marker_name())
}

fn likely_bootstrap_markers_with_name(
    install_root: &Path,
    primary_name: &str,
    _internal: bool,
) -> Vec<PathBuf> {
    let primary = install_root.join(primary_name);
    let mut markers = vec![primary.clone()];
    for legacy_name in [".hermes-bootstrap-complete"] {
        let legacy = install_root.join(legacy_name);
        if legacy != primary {
            markers.push(legacy);
        }
    }
    markers
}

pub fn likely_bootstrap_markers(install_root: &Path) -> Vec<PathBuf> {
    likely_bootstrap_markers_with_name(
        install_root,
        &bootstrap_marker_name(),
        internal_desktop_build(),
    )
}

/// Initializes tracing to bootstrap-installer.log under LEMON_HOME/logs/.
/// Returns a guard that flushes the appender on drop — keep it alive for
/// the lifetime of the process.
pub fn init_logging() -> Option<WorkerGuard> {
    let dir = log_dir();
    if let Err(err) = std::fs::create_dir_all(&dir) {
        // No log dir → log to stderr only. Don't panic; the installer
        // should still be usable on an exotic filesystem.
        eprintln!("[lemon-setup] could not create log dir {dir:?}: {err}");
        return None;
    }

    let file_appender = tracing_appender::rolling::never(&dir, "bootstrap-installer.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let env_filter = tracing_subscriber::EnvFilter::try_from_env("LEMON_BOOTSTRAP_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .init();

    Some(guard)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_log_path() -> String {
    log_path().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn get_lemon_home() -> String {
    lemon_home().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = log_dir();
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tmp_dir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "lemon-paths-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn unsafe_environment_file_names_fall_back_to_identity_defaults() {
        for value in ["", " ", ".", "..", "../x", "x/y", "x\\y", "x..y"] {
            assert_eq!(safe_file_name(Some(value), "safe-name"), "safe-name");
        }
        assert_eq!(
            safe_file_name(Some(" lemon-agent "), "fallback"),
            "lemon-agent"
        );
    }

    #[test]
    fn internal_runtime_default_is_lemon_agent() {
        assert_eq!(default_runtime_dir_name(true), "lemon-agent");
        assert_eq!(default_runtime_dir_name(false), "lemon-agent");
    }

    #[test]
    fn compiled_lemon_installer_brand_is_internal_identity_signal() {
        assert!(internal_desktop_build_for(None, None, None, Some("lemon")));
        assert_eq!(default_runtime_dir_name(true), "lemon-agent");
        assert_eq!(fallback_home_dir_name(true), ".lemon-ai");
        assert_eq!(fallback_home_dir_name(false), ".lemon-ai");
        assert_eq!(
            runtime_dir_name_for(true, None, Some("lemon-agent")),
            "lemon-agent"
        );
        assert_eq!(
            runtime_dir_name_for(true, Some("lemon-custom"), Some("lemon-agent")),
            "lemon-custom"
        );
        assert_eq!(
            home_override_for(true, None, Some("/legacy/lemon")),
            None,
            "internal installer ignores inherited legacy LEMON_HOME"
        );
        assert_eq!(
            home_override_for(true, Some("/company/lemon"), Some("/legacy/lemon")),
            Some(PathBuf::from("/company/lemon"))
        );
        assert_eq!(
            default_update_marker_name(true),
            ".lemon-ai-update-in-progress"
        );
    }

    #[test]
    fn lemon_harness_selector_uses_internal_identity_before_legacy_selector() {
        let base = std::env::temp_dir().join(format!(
            "lemon-paths-harness-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(
            &base,
            r#"{
              "schemaVersion": 1,
              "profile": "internal",
              "ui": {"agents": true, "cron": true, "messaging": true, "terminal": true, "webhooks": true}
            }"#,
        )
        .unwrap();
        assert!(internal_desktop_build_for(
            None,
            base.to_str(),
            Some("/missing/legacy-harness.json"),
            Some("lemon")
        ));
        assert_eq!(
            runtime_dir_name_for(true, None, Some("lemon-agent")),
            "lemon-agent"
        );
        assert_eq!(
            home_override_for(true, None, Some("/legacy/lemon")),
            None,
            "internal identity must not adopt legacy LEMON_HOME by default"
        );

        let _ = std::fs::remove_file(&base);
    }

    #[test]
    fn legacy_harness_selector_still_uses_internal_identity() {
        let base = std::env::temp_dir().join(format!(
            "lemon-paths-legacy-harness-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(
            &base,
            r#"{
              "schemaVersion": 1,
              "profile": "internal",
              "ui": {"agents": true, "cron": true, "messaging": true, "terminal": true, "webhooks": true}
            }"#,
        )
        .unwrap();
        assert!(internal_desktop_build_for(
            None,
            None,
            base.to_str(),
            Some("lemon")
        ));

        let _ = std::fs::remove_file(&base);
    }

    #[test]
    fn child_env_carries_lemon_identity_when_internal() {
        let envs = desktop_identity_child_env_for(
            true,
            "lemon-custom".to_string(),
            default_bootstrap_marker_name(true).to_string(),
            default_update_marker_name(true).to_string(),
            product_name_for(true),
        );

        let lookup = |name: &str| {
            envs.iter()
                .find(|(key, _)| *key == name)
                .and_then(|(_, value)| value.to_str())
        };
        assert_eq!(lookup("LEMON_DESKTOP_INTERNAL"), Some("1"));
        assert_eq!(
            lookup("LEMON_INSTALL_RUNTIME_DIR_NAME"),
            Some("lemon-custom")
        );
        assert_eq!(
            lookup("LEMON_DESKTOP_RUNTIME_DIR_NAME"),
            Some("lemon-custom")
        );
        assert_eq!(
            lookup("LEMON_BOOTSTRAP_MARKER_NAME"),
            Some(".lemon-ai-bootstrap-complete")
        );
        assert_eq!(
            lookup("LEMON_UPDATE_MARKER_NAME"),
            Some(".lemon-ai-update-in-progress")
        );
        assert_eq!(lookup("LEMON_UPDATE_PRODUCT_NAME"), Some("Lemon AI"));
        assert_eq!(
            lookup("LEMON_UPDATE_RESULT_NAME"),
            Some(".lemon-ai-update-result.json")
        );
    }

    #[test]
    fn internal_install_root_never_adopts_legacy_checkout_implicitly() {
        let home = unique_tmp_dir("install-root");
        std::fs::create_dir_all(home.join("lemon-agent")).unwrap();

        assert_eq!(
            install_root_for_home_with_runtime(&home, "lemon-agent", true),
            home.join("lemon-agent")
        );

        assert_eq!(
            install_root_for_home_with_runtime(&home, "lemon-agent", true),
            home.join("lemon-agent"),
            "internal builds keep the Lemon runtime even if a legacy checkout exists"
        );
        assert_eq!(
            install_root_for_home_with_runtime(&home, "lemon-agent", true),
            home.join("lemon-agent"),
            "an explicit compatibility runtime name can still select Lemon AI"
        );

        assert_eq!(
            install_root_for_home_with_runtime(&home, "lemon-agent", false),
            home.join("lemon-agent"),
            "ordinary builds keep the Lemon AI runtime root"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn bootstrap_marker_lookup_deduplicates_the_canonical_name() {
        let root = Path::new("/tmp/root");
        assert_eq!(default_bootstrap_marker_name(true), ".lemon-ai-bootstrap-complete");
        assert_eq!(default_bootstrap_marker_name(false), ".lemon-ai-bootstrap-complete");
        assert_eq!(
            likely_bootstrap_markers_with_name(root, ".lemon-ai-bootstrap-complete", true),
            vec![
                root.join(".lemon-ai-bootstrap-complete"),
                root.join(".hermes-bootstrap-complete"),
            ]
        );
        assert_eq!(
            likely_bootstrap_markers_with_name(root, ".lemon-ai-bootstrap-complete", false),
            vec![
                root.join(".lemon-ai-bootstrap-complete"),
                root.join(".hermes-bootstrap-complete"),
            ]
        );
    }
}
