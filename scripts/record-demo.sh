#!/usr/bin/env bash
# Record the ~20s uninvent demo.
#
# Shot list, dark terminal, large font, crop to the terminal:
#   1. uninvent scan
#        -> "N components, 2 stories, catalog written to .uninvent/catalog.json"
#   2. uninvent exists Dialog
#        -> file, import, props, radix
#   3. Cut to examples/demo-app/src/components/Modal.tsx (a native <dialog>)
#   4. uninvent check
#        -> one line per miss, including raw <dialog> ... use ui/Dialog
#   5. uninvent check src/pages/Customers.tsx
#        -> prints nothing (the screen already uses the system)
#
# This script plays steps 1, 2, 4, and 5 so you can capture them.
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
show "${UNINVENT[@]}" exists Dialog --cwd examples/demo-app
printf '\n$ uninvent check --cwd examples/demo-app\n'
"${UNINVENT[@]}" check --cwd examples/demo-app || true
printf '\n$ uninvent check --cwd examples/demo-app src/pages/Customers.tsx\n'
"${UNINVENT[@]}" check --cwd examples/demo-app src/pages/Customers.tsx
printf '# exit %s (no output above means the file is clean)\n' "$?"
