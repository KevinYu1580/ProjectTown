#!/usr/bin/env bash
# Print the body of "## [X.Y.Z] - date" from CHANGELOG.md (heading excluded,
# up to the next "## [" heading). Usage: changelog-section.sh vX.Y.Z | X.Y.Z
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <version>" >&2
  exit 2
fi

version="${1#v}"
changelog="$(cd "$(dirname "$0")/.." && pwd)/CHANGELOG.md"

section="$(awk -v ver="$version" '
  /^## \[/ {
    if (found) exit
    if (index($0, "## [" ver "]") == 1) { found = 1; next }
  }
  found { print }
' "$changelog")"

if ! grep -q -F "## [$version]" "$changelog"; then
  echo "error: no changelog section for $version in $changelog" >&2
  exit 1
fi

# Trim leading and trailing blank lines.
trimmed="$(printf '%s\n' "$section" | awk 'NF { started = 1 } started { buf[++n] = $0 } END { while (n > 0 && buf[n] ~ /^[[:space:]]*$/) n--; for (i = 1; i <= n; i++) print buf[i] }')"

if [ -z "$trimmed" ]; then
  echo "error: no changelog section for $version in $changelog" >&2
  exit 1
fi

printf '%s\n' "$trimmed"
