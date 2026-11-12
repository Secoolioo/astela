#!/usr/bin/env bash
# Installs the pinned release of lychee, the link checker of the website, for Linux x64 and
# checks the archive against its SHA-256. In GitHub Actions the folder joins the PATH of the
# later steps; elsewhere the script prints the folder.
#
# Usage: tools/ci/install-lychee.sh
set -euo pipefail

version=0.24.2
sha256=1f4e0ef7f6554a6ed33dd7ac144fb2e1bbed98598e7af973042fc5cd43951c9a
archive=lychee-x86_64-unknown-linux-gnu.tar.gz
folder="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/lychee-$version"

if [[ ! -x "$folder/lychee-x86_64-unknown-linux-gnu/lychee" ]]; then
  mkdir -p "$folder"
  curl -sSfL --retry 3 -o "$folder/$archive" \
    "https://github.com/lycheeverse/lychee/releases/download/lychee-v$version/$archive"
  echo "$sha256  $folder/$archive" | sha256sum --check --strict
  tar -xzf "$folder/$archive" -C "$folder"
fi

bin="$folder/lychee-x86_64-unknown-linux-gnu"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$bin" >>"$GITHUB_PATH"
fi
echo "$bin"
