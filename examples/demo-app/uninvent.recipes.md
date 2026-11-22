# Recipes

Patterns this project already uses. Edit this file by hand. `uninvent scan` copies it into the catalog.

## Confirm dialog

intents: confirm dialog, confirmation dialog, are you sure
uses: Dialog, DialogContent, DialogTitle, DialogDescription, Button
summary: Ask before a destructive action. A title, a description, and a cancel/confirm Button row.

```tsx
<Dialog>
  <DialogContent>
    <DialogTitle>Delete customer?</DialogTitle>
    <DialogDescription>This cannot be undone.</DialogDescription>
    <Button variant="outline">Cancel</Button>
    <Button>Delete</Button>
  </DialogContent>
</Dialog>
```
