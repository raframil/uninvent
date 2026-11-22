---
name: uninvent
description: "Look up this project's design system before adding UI. Use when creating or editing screens, buttons, dialogs, inputs, tables, or any React component. Catalog includes Button, Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription, Input, PageHeader, Table, TableHeader."
---

<!-- uninvent:generated -->

# uninvent

This project already has a design system. Reuse it. Do not invent a parallel button, dialog, input, or screen primitive.

Before creating UI, ask the catalog:

```bash
uninvent exists <Component>
```

After a screen is written, raw `<button>`, `<input>`, `<textarea>`, `<select>`, `<dialog>`, or `<a role="button">` is a miss when the catalog has that component. So is a new export whose name matches the catalog. The hook prints one short line per miss and nothing when the edit is clean. There is no autofix: change the code to the import it names.

## Catalog

### src/components/ui/button.tsx

`import { Button } from "@/components/ui/button";`
- Button — props: asChild; variants: variant (default | destructive | outline | secondary | ghost | link), size (default | sm | lg | icon); renders <button>

### src/components/ui/dialog.tsx

`import { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";`
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
