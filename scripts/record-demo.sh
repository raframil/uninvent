#!/usr/bin/env bash
# Record the uninvent demo.
#
# Shot list, dark terminal, large font, crop to the terminal:
#   1. uninvent scan
#        -> "N components, 2 stories, 1 recipe, catalog written to .uninvent/catalog.json"
#   2. uninvent exists "confirm dialog"
#        -> the recipe, the components it uses, the example
#   3. uninvent exists Dialog
#        -> file, import, props, radix
#   4. Cut to examples/demo-app/src/components/Confirm.tsx (a hand-rolled confirm)
#   5. uninvent check
#        -> one line per miss, including the confirm-dialog recipe
#   6. uninvent check src/pages/Customers.tsx
#        -> prints nothing (the screen already uses the system)
#
# This script plays the scan, both exists queries, and both checks.
# It does not render a GIF. With https://github.com/charmbracelet/vhs installed:
#
#   vhs scripts/demo.tape
#
# That writes docs/demo.gif. Until the GIF exists, the README shows the transcript.

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
show "${UNINVENT[@]}" exists Dialog --cwd examples/demo-app
printf '\n$ uninvent check --cwd examples/demo-app\n'
"${UNINVENT[@]}" check --cwd examples/demo-app || true
printf '\n$ uninvent check --cwd examples/demo-app src/pages/Customers.tsx\n'
"${UNINVENT[@]}" check --cwd examples/demo-app src/pages/Customers.tsx
printf '# exit %s (no output above means the file is clean)\n' "$?"
