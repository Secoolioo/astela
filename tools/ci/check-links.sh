#!/usr/bin/env bash
# Checks the links within a built website without going online. Pages serves the site below
# the path of the repository, so the site is laid out below that path first, as it is served.
# The same check runs in pnpm verify, on the site of a pull request, and in pages.yml, on the
# site that is deployed; it needs lychee (tools/ci/install-lychee.sh) on the PATH.
#
# Usage: tools/ci/check-links.sh <folder of the built site>
set -euo pipefail

site=$(cd "$1" && pwd)
root=$(cd "$(dirname "$0")/../.." && pwd)
base=$(node -p "new URL(require(process.argv[1]).website).pathname" "$root/brand.json")
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage$base"
cp -R "$site/." "$stage$base"
lychee --offline --no-progress --root-dir "$stage" "$stage/**/*.html"
