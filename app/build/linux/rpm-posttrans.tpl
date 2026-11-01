#!/bin/bash
# Runs at the end of every rpm transaction that installs or upgrades the package, after the
# removal script of the version it replaces. Packages up to 0.1.0-beta.2 removed the command
# link and the AppArmor profile in that script even on an upgrade, so both are set up again
# here; on every other transaction this changes nothing. @SLUG@ and @PRODUCT@ come from
# brand.json.
if [ -x '/opt/@PRODUCT@/@SLUG@' ]; then
  if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --install '/usr/bin/@SLUG@' '@SLUG@' '/opt/@PRODUCT@/@SLUG@' 100 ||
      ln -sf '/opt/@PRODUCT@/@SLUG@' '/usr/bin/@SLUG@'
  else
    ln -sf '/opt/@PRODUCT@/@SLUG@' '/usr/bin/@SLUG@'
  fi
  # The same check as in the install script: only an AppArmor that supports the profile.
  if apparmor_status --enabled >/dev/null 2>&1; then
    APPARMOR_PROFILE_SOURCE='/opt/@PRODUCT@/resources/apparmor-profile'
    APPARMOR_PROFILE_TARGET='/etc/apparmor.d/@SLUG@'
    if [ ! -e "$APPARMOR_PROFILE_TARGET" ] &&
      apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" >/dev/null 2>&1; then
      cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
      if hash apparmor_parser 2>/dev/null; then
        apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET" || true
      fi
    fi
  fi
fi
