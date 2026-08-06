//! Keeps Windows' "Apps & features" honest about the installed version.
//!
//! ALIGN-002 (reopened 2026-08-06): HKCU\...\Uninstall\Beatform's
//! `DisplayVersion` sat at 2.39.0 through five successful auto-updates
//! while the binary reached 2.72.0. The NSIS template writes the value
//! unconditionally and invoking the 2.72.0 installer by hand with the
//! updater's exact arguments (`/P /UPDATE`) DID write it — so whatever
//! occasionally skips the write lives somewhere in the historical
//! updater→installer handoff, not in anything this repo can patch.
//! The app itself is the one component guaranteed to run after every
//! successful update, so it repairs its own uninstall entry on boot:
//! self-healing beats archaeology on five generations of installers.
//!
//! Best-effort by design: no key (portable/dev run) means no work, and
//! a registry error must never affect startup.

use winreg::enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
use winreg::RegKey;

const UNINSTALL_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Beatform";

/// Rewrite `DisplayVersion` under the given uninstall subkey when it
/// disagrees with `version`. Returns what happened for logging/tests.
fn heal_subkey(subkey: &str, version: &str) -> Result<bool, std::io::Error> {
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(subkey, KEY_QUERY_VALUE | KEY_SET_VALUE)?;
    let current: String = key.get_value("DisplayVersion").unwrap_or_default();
    if current == version {
        return Ok(false);
    }
    key.set_value("DisplayVersion", &version.to_string())?;
    Ok(true)
}

/// Boot-time repair of the real uninstall entry. Debug builds skip: a
/// `cargo run` must never stamp a dev build's version onto the entry the
/// INSTALLED app owns.
pub fn heal() {
    // cfg! (not #[cfg]) so debug builds still compile the real path —
    // keeps the helper "used" in every profile and the guard testable.
    if cfg!(debug_assertions) {
        return;
    }
    match heal_subkey(UNINSTALL_SUBKEY, env!("CARGO_PKG_VERSION")) {
        Ok(true) => eprintln!(
            "[uninstall-entry] DisplayVersion healed to {}",
            env!("CARGO_PKG_VERSION")
        ),
        Ok(false) => {}
        // Key absent (portable run) or unwritable — nothing to do.
        Err(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use winreg::enums::KEY_ALL_ACCESS;

    /// Real registry round-trip against a scratch key: stale value gets
    /// rewritten, matching value is left alone, missing key errors.
    #[test]
    fn heals_stale_display_version_and_respects_current() {
        let scratch = format!(r"Software\BeatformTest\heal-{}", std::process::id());
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu.create_subkey(&scratch).unwrap();
        key.set_value("DisplayVersion", &"2.39.0".to_string())
            .unwrap();

        assert!(
            heal_subkey(&scratch, "9.9.9").unwrap(),
            "stale value must heal"
        );
        let key = hkcu
            .open_subkey_with_flags(&scratch, KEY_ALL_ACCESS)
            .unwrap();
        let v: String = key.get_value("DisplayVersion").unwrap();
        assert_eq!(v, "9.9.9");

        assert!(
            !heal_subkey(&scratch, "9.9.9").unwrap(),
            "match must be a no-op"
        );

        hkcu.delete_subkey_all(r"Software\BeatformTest").unwrap();
        assert!(
            heal_subkey(&scratch, "1.0.0").is_err(),
            "missing key must error, not create"
        );
    }
}
