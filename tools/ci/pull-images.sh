#!/usr/bin/env bash
# Pulls container images before a job starts them. A registry can fail a pull for a moment, for
# example with 502 Bad Gateway, so each pull is tried up to four times before the job fails.
#
# Usage: tools/ci/pull-images.sh <image>...
set -euo pipefail

for image in "$@"; do
  for attempt in 1 2 3 4; do
    if docker pull --quiet "$image" >/dev/null; then
      break
    fi
    if [ "$attempt" = 4 ]; then
      echo "The image $image could not be pulled" >&2
      exit 1
    fi
    echo "The pull of $image failed; trying again" >&2
    sleep $((attempt * 15))
  done
done
