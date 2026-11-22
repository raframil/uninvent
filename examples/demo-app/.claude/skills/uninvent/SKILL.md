---
name: uninvent
description: "Look up this project's design system before adding UI. Use when creating or editing screens, buttons, dialogs, inputs, tables, or any React component. Catalog includes Button, Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription, Input, PageHeader, Table, TableHeader. Recipes: Confirm dialog."
---

<!-- uninvent:generated -->

# uninvent

This project already has a design system. Reuse it. Do not invent a parallel button, dialog, input, or screen primitive.

Before creating UI, ask the catalog:

```bash
uninvent exists <Component>
```

After a screen is written, raw `<button>`, `<input>`, `<textarea>`, `<select>`, `<dialog>`, or `<a role="button">` is a miss when the catalog has that component. So is a new export whose name matches the catalog. The wrapper may be Radix, Base UI, or another library on the primitive adapter map; the miss is the raw element, not the library. The hook prints one short line per miss and nothing when the edit is clean. There is no autofix: change the code to the import it names.

A recipe is how this project assembles those components. Rebuilding it from raw elements is a miss. The hook names the recipe and the components it uses.

## Catalog

### src/components/ui/button.tsx

`import { Button } from "@/components/ui/button";`
primitives: radix (@radix-ui/react-slot)
- Button — props: asChild; variants: variant (default | destructive | outline | secondary | ghost | link), size (default | sm | lg | icon); renders <button>

### src/components/ui/dialog.tsx

`import { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";`
primitives: radix (@radix-ui/react-dialog)
- Dialog — props: open, onOpenChange, children
- DialogTrigger
- DialogClose
- DialogContent — props: className, children
- DialogHeader — props: children
- DialogTitle — props: children
- DialogDescription — props: children

### src/components/ui/input.tsx

`import { Input } from "@/components/ui/input";`
- Input — renders <input>

### src/components/ui/page-header.tsx

`import { PageHeader } from "@/components/ui/page-header";`
- PageHeader — props: title, description, actions, className

### src/components/ui/table.tsx

`import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";`
- Table — renders <table>
- TableHeader
- TableBody
- TableRow
- TableHead
- TableCell

## Recipes

Prefer a recipe over assembling the same UI from raw elements.

- **Confirm dialog** — Ask before a destructive action. A title, a description, and a cancel/confirm Button row. Uses Dialog, DialogContent, DialogTitle, DialogDescription, Button.

Run `uninvent exists "<recipe>"` for the imports and the example.
