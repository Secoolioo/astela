#!/usr/bin/env bash
# Installs Ubuntu packages on a runner of CI. The package mirrors of the runners can fail for
# minutes, for example when their names do not resolve, so the lists are read again and the
# installation is tried up to four times, waiting longer before each new try.
#
# The names under ubuntu.com have also failed to resolve on the runners for hours, which no
# retry outlasts. When they do not resolve, or the second try failed, the Ubuntu sources switch
# to the first mirror outside ubuntu.com that serves this release. apt still checks the
# signature of the Ubuntu archive, so only the route changes, not what is trusted. The mirror is
# written to $GITHUB_ENV as UBUNTU_MIRROR for later steps, such as the containers of the test of
# the package repositories.
#
# Usage: tools/ci/apt-install.sh <package>...
set -euo pipefail

# Only the test of this script points these at other files.
apt_dir=${APT_DIR:-/etc/apt}
os_release=${OS_RELEASE:-/etc/os-release}

missing=()
for package in "$@"; do
  status=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
  [ "$status" = "install ok installed" ] || missing+=("$package")
done
if [ "${#missing[@]}" = 0 ]; then
  echo "The packages $* are installed already"
  exit 0
fi

arch=$(dpkg --print-architecture)
if [ "$arch" = amd64 ]; then
  archive=archive.ubuntu.com
  mirrors=(https://mirrors.edge.kernel.org/ubuntu https://mirror.us.leaseweb.net/ubuntu)
else
  archive=ports.ubuntu.com
  mirrors=(https://mirrors.ocf.berkeley.edu/ubuntu-ports https://mirrors.mit.edu/ubuntu-ports
    https://mirror.us.leaseweb.net/ubuntu-ports)
fi

# Points the Ubuntu sources at the first of the mirrors that serves this release.
use_other_mirror() {
  local codename mirror files
  codename=$(sed -n 's/^VERSION_CODENAME=//p' "$os_release")
  for mirror in "${mirrors[@]}"; do
    if curl -fsS --max-time 20 -o /dev/null "$mirror/dists/$codename/InRelease"; then
      mapfile -t files < <(find "$apt_dir" -maxdepth 2 \( -name sources.list -o -name '*.sources' -o -name '*.list' \) -type f)
      [ "${#files[@]}" -gt 0 ] || return 1
      sudo sed -i -E \
        -e "s#mirror\+file:[^ ]*apt-mirrors\.txt#$mirror/#g" \
        -e "s#https?://([a-z0-9-]+\.)*archive\.ubuntu\.com/ubuntu/?#$mirror/#g" \
        -e "s#https?://security\.ubuntu\.com/ubuntu/?#$mirror/#g" \
        -e "s#https?://ports\.ubuntu\.com(/ubuntu-ports)?/?#$mirror/#g" \
        "${files[@]}"
      echo "UBUNTU_MIRROR=$mirror" >>"${GITHUB_ENV:-/dev/null}"
      echo "The Ubuntu mirrors could not be reached; the packages come from $mirror" >&2
      return 0
    fi
  done
  echo "No other mirror serves $codename either" >&2
  return 1
}

switched=false
for attempt in 1 2 3 4; do
  if [ "$switched" = false ] && { [ "$attempt" -ge 3 ] || ! timeout 15 getent hosts "$archive" >/dev/null; }; then
    if use_other_mirror; then switched=true; fi
  fi
  # A list that cannot be read keeps the one from the runner image, which often still serves.
  sudo apt-get -o Acquire::Retries=3 update -qq || echo "The package lists could not be read" >&2
  if sudo apt-get -o Acquire::Retries=3 install -y "${missing[@]}"; then
    exit 0
  fi
  if [ "$attempt" = 4 ]; then
    echo "The packages ${missing[*]} could not be installed" >&2
    exit 1
  fi
  echo "The installation of ${missing[*]} failed; trying again" >&2
  sleep $((attempt * 30))
done
