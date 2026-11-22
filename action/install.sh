#!/usr/bin/env bash
# Install uninvent onto PATH for the next steps of the composite action.
# version=local (or an empty version when dist/cli.js exists) uses this checkout.
# Anything else is `npm install uninvent@<version>` into RUNNER_TEMP, not the app.

set -euo pipefail

if [[ -z "${ACTION_PATH:-}" ]]; then
  echo "ACTION_PATH is not set." >&2
  exit 1
fi
if [[ -z "${RUNNER_TEMP:-}" ]]; then
  echo "RUNNER_TEMP is not set." >&2
  exit 1
fi
if [[ -z "${GITHUB_PATH:-}" ]]; then
  echo "GITHUB_PATH is not set." >&2
  exit 1
fi

VERSION="${VERSION:-}"
decision="$(node "$ACTION_PATH/action/version.mjs" "$VERSION" "$ACTION_PATH")"
source_kind="${decision%% *}"
rest="${decision#* }"

bindir="$RUNNER_TEMP/uninvent-bin"
mkdir -p "$bindir"

if [[ "$source_kind" == "local" ]]; then
  cli="$ACTION_PATH/dist/cli.js"
  if [[ ! -f "$cli" ]]; then
    echo "version resolution asked for a local build, but dist/cli.js is missing." >&2
    exit 1
  fi
  chmod +x "$cli"
  quoted="$(printf '%q' "$cli")"
  cat > "$bindir/uninvent" << EOF
#!/usr/bin/env bash
exec node ${quoted} "\$@"
EOF
  chmod +x "$bindir/uninvent"
  echo "Using the local uninvent build at $cli"
elif [[ "$source_kind" == "npm" ]]; then
  if ! [[ "$rest" =~ ^[A-Za-z0-9._+-]+$ ]]; then
    echo "Refusing to install uninvent@${rest}" >&2
    exit 1
  fi
  prefix="$RUNNER_TEMP/uninvent-prefix"
  rm -rf "$prefix"
  mkdir -p "$prefix"
  echo "Installing uninvent@${rest}"
  (
    cd "$prefix"
    npm init -y >/dev/null
    npm install --no-audit --no-fund --loglevel=error "uninvent@${rest}"
  )
  bin="$prefix/node_modules/.bin/uninvent"
  if [[ ! -x "$bin" && ! -f "$bin" ]]; then
    echo "npm install did not produce $bin" >&2
    exit 1
  fi
  quoted="$(printf '%q' "$bin")"
  cat > "$bindir/uninvent" << EOF
#!/usr/bin/env bash
exec ${quoted} "\$@"
EOF
  chmod +x "$bindir/uninvent"
else
  echo "Unexpected version decision: $decision" >&2
  exit 1
fi

echo "$bindir" >> "$GITHUB_PATH"
