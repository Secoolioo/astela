#!/usr/bin/env bash
# Installs Ubuntu packages on a runner of CI. The package mirrors of the runners can fail for
# minutes, for example when their names do not resolve, so the lists are read again and the
# installation is tried up to four times, waiting longer before each new try.
#
# Usage: tools/ci/apt-install.sh <package>...
set -euo pipefail

for attempt in 1 2 3 4; do
  # A list that cannot be read keeps the one from the runner image, which often still serves.
  sudo apt-get -o Acquire::Retries=3 update -qq || echo "The package lists could not be read" >&2
  if sudo apt-get -o Acquire::Retries=3 install -y "$@"; then
    exit 0
  fi
  if [ "$attempt" = 4 ]; then
    echo "The packages $* could not be installed" >&2
    exit 1
  fi
  echo "The installation of $* failed; trying again" >&2
  sleep $((attempt * 30))
done
