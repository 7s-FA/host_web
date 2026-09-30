#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
exec python3 -m http.server "${PORT:-8082}" --bind "${BIND:-127.0.0.1}"
