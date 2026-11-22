# Recipes

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

## Form field

intents: form field, labeled input, field error
uses: Input
summary: A label, an Input, and a short error line.

```tsx
<div>
  <label htmlFor="email">Email</label>
  <Input id="email" />
  <p>Enter a valid email.</p>
</div>
```
