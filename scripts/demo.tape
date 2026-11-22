# vhs script for the demo GIF. Requires https://github.com/charmbracelet/vhs
# From the repo root, after `npm install && npm run build`:
#   vhs scripts/demo.tape
Output docs/demo.gif

Set Theme "Catppuccin Mocha"
Set FontSize 22
Set Width 1100
Set Height 640
Set Padding 28
Set Shell "bash"

Hide
Type "cd examples/demo-app" Enter
Sleep 200ms
Show

Type "npx uninvent scan" Sleep 400ms Enter
Sleep 2s

Type "npx uninvent exists \"confirm dialog\"" Sleep 300ms Enter
Sleep 3s

Type "npx uninvent exists \"loading button\"" Sleep 300ms Enter
Sleep 2s

Type "npx uninvent check src/components/Confirm.tsx" Sleep 300ms Enter
Sleep 2s

Type "npx uninvent check src/components/SaveButton.tsx" Sleep 300ms Enter
Sleep 2s

Type "npx uninvent check src/pages/Customers.tsx" Sleep 300ms Enter
Sleep 2s
