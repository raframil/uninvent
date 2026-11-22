#!/usr/bin/env bash
# Record the uninvent demo.
#
# Shot list, dark terminal, large font, crop to the terminal:
#   1. uninvent scan
#        -> "16 components, 3 stories, 6 states, 1 recipe, catalog written to .uninvent/catalog.json"
#   2. uninvent exists "confirm dialog"
#        -> the recipe, the components it uses, the example
#   3. uninvent exists "loading button"
#        -> Button's loading state and the story that documents it
#   4. uninvent check src/components/Confirm.tsx
#        -> the confirm-dialog recipe
#   5. uninvent check src/components/SaveButton.tsx
#        -> Button's loading state
#   6. uninvent check src/pages/Customers.tsx
#        -> prints nothing (the screen already uses the system)
#
# This script plays that sequence. It does not render a GIF.
# With https://github.com/charmbracelet/vhs installed, from the repo root
# after npm install && npm run build:
#
#   vhs scripts/demo.tape
#
# That writes docs/demo.gif. The tape calls node ../../dist/cli.js so the
# demo app does not need its own install. Until the GIF exists, the README
# shows the transcript.

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -x node_modules/.bin/uninvent ]]; then
  UNINVENT=(node_modules/.bin/uninvent)
elif command -v uninvent >/dev/null 2>&1; then
  UNINVENT=(uninvent)
else
  UNINVENT=(node --import tsx src/cli.ts)
fi

show() {
  printf '\n$ %s\n' "$*"
  "$@"
}

show "${UNINVENT[@]}" scan --cwd examples/demo-app
show "${UNINVENT[@]}" exists "confirm dialog" --cwd examples/demo-app
show "${UNINVENT[@]}" exists "loading button" --cwd examples/demo-app
printf '\n$ uninvent check --cwd examples/demo-app src/components/Confirm.tsx\n'
"${UNINVENT[@]}" check --cwd examples/demo-app src/components/Confirm.tsx || true
printf '\n$ uninvent check --cwd examples/demo-app src/components/SaveButton.tsx\n'
"${UNINVENT[@]}" check --cwd examples/demo-app src/components/SaveButton.tsx || true
printf '\n$ uninvent check --cwd examples/demo-app src/pages/Customers.tsx\n'
"${UNINVENT[@]}" check --cwd examples/demo-app src/pages/Customers.tsx
printf '# exit %s (no output above means the file is clean)\n' "$?"
