import type { TrialArm } from "./types.js";

/**
 * Canned agent output for dry-run. These files are replayed onto the pinned
 * tree so `uninvent check` can score a diff without a model. They are not
 * trial results and must not be copied into CASE_STUDY.md as measurements.
 *
 * The baseline arm uses raw controls. The uninvent arm imports the design
 * system that is already in the pinned repo.
 */
const shadcnAdmin: Record<string, Record<TrialArm, string>> = {
  "settings-dialog": {
    baseline: `export function SettingsDialog() {
  return (
    <div>
      <button type="button">Settings</button>
      <dialog open>
        <h2>Settings</h2>
        <p>Choose how your name appears.</p>
        <label>
          Display name
          <input name="displayName" />
        </label>
        <button type="button">Close</button>
      </dialog>
    </div>
  )
}
`,
    uninvent: `import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Settings</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Choose how your name appears.</DialogDescription>
        </DialogHeader>
        <Label htmlFor="display-name">Display name</Label>
        <Input id="display-name" name="displayName" />
      </DialogContent>
    </Dialog>
  )
}
`,
  },
  "confirm-delete": {
    baseline: `export function ConfirmDelete() {
  return (
    <div>
      <button type="button">Delete</button>
      <dialog open>
        <h2>Delete user?</h2>
        <p>This cannot be undone.</p>
        <button type="button">Cancel</button>
        <button type="button">Delete</button>
      </dialog>
    </div>
  )
}
`,
    uninvent: `import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

export function ConfirmDelete() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete user?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
`,
  },
  "role-filter": {
    baseline: `export function RoleFilter() {
  return (
    <label>
      Role
      <select name="role" defaultValue="member">
        <option value="admin">Admin</option>
        <option value="member">Member</option>
        <option value="guest">Guest</option>
      </select>
    </label>
  )
}
`,
    uninvent: `import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function RoleFilter() {
  return (
    <Select defaultValue="member">
      <SelectTrigger>
        <SelectValue placeholder="Role" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="member">Member</SelectItem>
        <SelectItem value="guest">Guest</SelectItem>
      </SelectContent>
    </Select>
  )
}
`,
  },
  "invite-form": {
    baseline: `export function InviteForm() {
  return (
    <form>
      <label>
        Email
        <input type="email" name="email" />
      </label>
      <label>
        Role
        <select name="role" defaultValue="member">
          <option value="admin">Admin</option>
          <option value="member">Member</option>
          <option value="guest">Guest</option>
        </select>
      </label>
      <label>
        <input type="checkbox" name="sendEmail" />
        Send invite email
      </label>
      <button type="submit">Send invite</button>
    </form>
  )
}
`,
    uninvent: `import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function InviteForm() {
  return (
    <form>
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" name="email" />
      <Label>Role</Label>
      <Select defaultValue="member">
        <SelectTrigger>
          <SelectValue placeholder="Role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="member">Member</SelectItem>
          <SelectItem value="guest">Guest</SelectItem>
        </SelectContent>
      </Select>
      <Label>
        <Checkbox name="sendEmail" />
        Send invite email
      </Label>
      <Button type="submit">Send invite</Button>
    </form>
  )
}
`,
  },
  "users-empty": {
    baseline: `export function UsersEmpty({ loading }: { loading?: boolean }) {
  if (loading) return <div className="h-24 animate-pulse" />
  return (
    <div>
      <p>No users yet.</p>
      <button type="button">Invite user</button>
    </div>
  )
}
`,
    uninvent: `import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function UsersEmpty({ loading }: { loading?: boolean }) {
  if (loading) return <Skeleton className="h-24 w-full" />
  return (
    <div>
      <p>No users yet.</p>
      <Button>Invite user</Button>
    </div>
  )
}
`,
  },
};

const taxonomy: Record<string, Record<TrialArm, string>> = {
  "settings-dialog": {
    baseline: shadcnAdmin["settings-dialog"]?.baseline ?? "",
    uninvent: shadcnAdmin["settings-dialog"]?.uninvent ?? "",
  },
  "confirm-delete": {
    baseline: `export function ConfirmDelete() {
  return (
    <div>
      <button type="button">Delete</button>
      <dialog open>
        <h2>Delete post?</h2>
        <p>This cannot be undone.</p>
        <button type="button">Cancel</button>
        <button type="button">Delete</button>
      </dialog>
    </div>
  )
}
`,
    uninvent: `import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

export function ConfirmDelete() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete post?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
`,
  },
  "post-filter": {
    baseline: `export function PostFilter() {
  return (
    <label>
      Status
      <select name="status" defaultValue="published">
        <option value="published">Published</option>
        <option value="draft">Draft</option>
      </select>
    </label>
  )
}
`,
    uninvent: `import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function PostFilter() {
  return (
    <Select defaultValue="published">
      <SelectTrigger>
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="published">Published</SelectItem>
        <SelectItem value="draft">Draft</SelectItem>
      </SelectContent>
    </Select>
  )
}
`,
  },
  "newsletter-form": {
    baseline: `export function NewsletterForm() {
  return (
    <form>
      <label>
        Email
        <input type="email" name="email" />
      </label>
      <label>
        Frequency
        <select name="frequency" defaultValue="weekly">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label>
        <input type="checkbox" name="product" />
        Product updates
      </label>
      <button type="submit">Subscribe</button>
    </form>
  )
}
`,
    uninvent: `import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function NewsletterForm() {
  return (
    <form>
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" name="email" />
      <Label>Frequency</Label>
      <Select defaultValue="weekly">
        <SelectTrigger>
          <SelectValue placeholder="Frequency" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="daily">Daily</SelectItem>
          <SelectItem value="weekly">Weekly</SelectItem>
        </SelectContent>
      </Select>
      <Label>
        <Checkbox name="product" />
        Product updates
      </Label>
      <Button type="submit">Subscribe</Button>
    </form>
  )
}
`,
  },
  "posts-empty": {
    baseline: `export function PostsEmpty({ loading }: { loading?: boolean }) {
  if (loading) return <div className="h-24 animate-pulse" />
  return (
    <div>
      <p>No posts yet.</p>
      <button type="button">New post</button>
    </div>
  )
}
`,
    uninvent: `import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function PostsEmpty({ loading }: { loading?: boolean }) {
  if (loading) return <Skeleton className="h-24 w-full" />
  return (
    <div>
      <p>No posts yet.</p>
      <Button>New post</Button>
    </div>
  )
}
`,
  },
};

const PUBLISHED: Record<string, Record<string, Record<TrialArm, string>>> = {
  "shadcn-admin": shadcnAdmin,
  taxonomy,
};

export function cannedSource(
  repoId: string,
  taskId: string,
  arm: TrialArm,
  extra?: Record<string, Record<string, Record<TrialArm, string>>>,
): string | null {
  const fromExtra = extra?.[repoId]?.[taskId]?.[arm];
  if (fromExtra !== undefined) return fromExtra;
  return PUBLISHED[repoId]?.[taskId]?.[arm] ?? null;
}
