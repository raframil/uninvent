# Case study

uninvent checks whether a coding agent reused the design system that is already in the repository. This note is the public record of that check: what shipped since 0.3.0, how the real-repository trial is run, and the fixed-corpus benchmark. The trial ran on 2026-11-22: [GitHub Actions run 45083175529](https://github.com/raframil/uninvent/actions/runs/45083175529).

## What uninvent is

A local catalog of the components, recipes, and documented Storybook states in the repo. `uninvent exists` answers a question from that catalog. `uninvent check` reads a diff and prints one line per miss: a raw control, a rebuilt recipe, a documented state copied by hand, or a second export of a catalog name. The PostToolUse hook prints the same line after a write, or nothing when the file is clean. It does not block the write, does not rewrite the file, and does not lint color tokens.

There is no MCP server and no autofix. uninvent does not try to be a general drift linter.

## Method

Two MIT-licensed React applications, each pinned to one commit. Both already contain a shadcn/ui component library on Radix. They are applications, not the shadcn registry itself.

| Repo | Commit | Why this one |
|---|---|---|
| [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | `e16c87f213a5ba5e45964e9b67c792105ec74d26` | Admin dashboard, about 17k stars. `src/components/ui` has Dialog, AlertDialog, DropdownMenu, Select, Checkbox, Form, Input, Button, and Skeleton. The pin is the 2026-06-11 commit that bumps `@clerk/react`. |
| [shadcn-ui/taxonomy](https://github.com/shadcn-ui/taxonomy) | `298a8857c7128a0d121e7f699dfd729f23b3966d` | The canonical Next.js app built with shadcn/ui, about 19k stars. `components/ui` is at the repo root and `@/*` maps to `./*`. A content app, so the second shape is not another dashboard. The pin is the 2026-04-20 commit `docs: update readme`. |

Tasks, five per repo. The prompt is the same in both arms. It names the file to create and the UI to add. It does not name uninvent.

| Repo | Task | File |
|---|---|---|
| shadcn-admin | Settings dialog | `src/features/trial/settings-dialog.tsx` |
| shadcn-admin | Confirm before delete | `src/features/trial/confirm-delete.tsx` |
| shadcn-admin | Role filter | `src/features/trial/role-filter.tsx` |
| shadcn-admin | Invite form (email, role, checkbox) | `src/features/trial/invite-form.tsx` |
| shadcn-admin | Empty and loading users | `src/features/trial/users-empty.tsx` |
| taxonomy | Settings dialog | `components/trial/settings-dialog.tsx` |
| taxonomy | Confirm before deleting a post | `components/trial/confirm-delete.tsx` |
| taxonomy | Post status filter | `components/trial/post-filter.tsx` |
| taxonomy | Newsletter form | `components/trial/newsletter-form.tsx` |
| taxonomy | Empty and loading posts | `components/trial/posts-empty.tsx` |

The agent is an OpenAI-compatible chat-completions client (`POST {base}/chat/completions`) with three tools: `write_file`, `read_file`, and `finish`. The primary host is [OpenRouter](https://openrouter.ai): `UNINVENT_BENCH_BASE_URL` defaults to `https://openrouter.ai/api/v1`, and the default model id is `openai/gpt-4o-mini`. `UNINVENT_BENCH_MODEL` may be one id or a comma-separated list (`anthropic/claude-sonnet-4.5, openai/gpt-4o-mini`), and the trial runs that list in order so one invocation compares models. When the base URL is OpenRouter, the client sends `HTTP-Referer` and `X-Title` and asks for `usage.include` so the response can carry a cost. Another OpenAI-compatible host still works if you point `UNINVENT_BENCH_BASE_URL` at it. Temperature is 0. Each task gets at most 6 turns. The default schedule is 2 runs per arm.

Arms:

- **baseline.** The task prompt only. uninvent is not installed. The hook does not run.
- **uninvent.** `uninvent init`, `uninvent install` (PostToolUse only, no `--pre`), and `uninvent scan`. The generated skill is in the system prompt. After each `write_file` the installed hook command runs. The write is already on disk. Silence stays silence. A miss comes back as one line per finding, which is the tool result the model sees on the next turn.

The judge is `uninvent check --base <pinned sha> --format json` on the committed diff. `reuse` and `invent` are that JSON. Raw controls are findings whose kind is `raw-element`. Tokens are `usage.total_tokens` when every response included them. Cost is recorded only when the provider returns a cost field. A run that errors is left unscored. It is not stored as zero.

These repositories do not ship an `uninvent.recipes.md`, and their UI folders are not a Storybook project. `check` can count raw controls, name collisions, and reuse. It does not invent a recipe or a documented state the repo never declared.

`npm run trial:report` rewrites the three generated sections below. A dry-run (`npm run trial -- --dry-run`) replays canned files, proves the harness, and does not fill those sections.

## Results

<!-- trial-results:start -->
Recorded 2026-11-22T23:38:51.598Z. Models `anthropic/claude-sonnet-4.5, openai/gpt-4o-mini` at `https://openrouter.ai/api/v1`. uninvent 0.4.1. 2 runs per arm. uninvent check --base <pinned sha> --format json. reuse and invent are that JSON. raw is findings of kind raw-element. Tokens are usage.total_tokens when every response included them. Cost is set only when the provider returned it. OpenRouter returns cost when the request asks for usage.

Pending rerun, not a result: anthropic/claude-sonnet-4.5.

| Model | Repo | Task | Arm | Scored | Reuse | Invent | Raw controls | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anthropic/claude-sonnet-4.5 | shadcn-admin | settings-dialog | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | shadcn-admin | settings-dialog | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | shadcn-admin | confirm-delete | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | shadcn-admin | confirm-delete | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | shadcn-admin | role-filter | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | shadcn-admin | role-filter | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | shadcn-admin | invite-form | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | shadcn-admin | invite-form | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | shadcn-admin | users-empty | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | shadcn-admin | users-empty | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | settings-dialog | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | settings-dialog | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | confirm-delete | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | confirm-delete | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | post-filter | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | post-filter | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | newsletter-form | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | newsletter-form | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | posts-empty | baseline | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| anthropic/claude-sonnet-4.5 | taxonomy | posts-empty | uninvent | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun | pending rerun |
| openai/gpt-4o-mini | shadcn-admin | settings-dialog | baseline | 2/2 | 0 (sd 0) | 0 (sd 0) | 0 (sd 0) | 1065 (sd 100.41) | 0 (sd 0) |
| openai/gpt-4o-mini | shadcn-admin | settings-dialog | uninvent | 2/2 | 11 (sd 0) | 0 (sd 0) | 0 (sd 0) | 6027 (sd 0) | 0 (sd 0) |
| openai/gpt-4o-mini | shadcn-admin | confirm-delete | baseline | 2/2 | 0 (sd 0) | 0 (sd 0) | 0 (sd 0) | 997 (sd 8.49) | 0 (sd 0) |
| openai/gpt-4o-mini | shadcn-admin | confirm-delete | uninvent | 2/2 | 12 (sd 0) | 0 (sd 0) | 0 (sd 0) | 10039 (sd 0) | 0 (sd 0) |
| openai/gpt-4o-mini | shadcn-admin | role-filter | baseline | 2/2 | 0 (sd 0) | 1 (sd 0) | 1 (sd 0) | 972 (sd 14.14) | 0 (sd 0) |
| openai/gpt-4o-mini | shadcn-admin | role-filter | uninvent | 2/2 | 7 (sd 0) | 0 (sd 0) | 0 (sd 0) | 5949 (sd 0) | 0 (sd 0) |
| openai/gpt-4o-mini | shadcn-admin | invite-form | baseline | 2/2 | 0 (sd 0) | 4 (sd 0) | 4 (sd 0) | 1357 (sd 0) | 0 (sd 0) |
| openai/gpt-4o-mini | shadcn-admin | invite-form | uninvent | 2/2 | 24 (sd 0) | 0 (sd 0) | 0 (sd 0) | 11186 (sd 21.21) | 0 (sd 0) |
| openai/gpt-4o-mini | shadcn-admin | users-empty | baseline | 2/2 | 0 (sd 0) | 0 (sd 0) | 0 (sd 0) | 895 (sd 1.41) | 0 (sd 0) |
| openai/gpt-4o-mini | shadcn-admin | users-empty | uninvent | 2/2 | 2 (sd 0) | 0 (sd 0) | 0 (sd 0) | 5903 (sd 0) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | settings-dialog | baseline | 2/2 | 0 (sd 0) | 2.5 (sd 0.71) | 2.5 (sd 0.71) | 1105 (sd 223.45) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | settings-dialog | uninvent | 2/2 | 10 (sd 0) | 0 (sd 0) | 0 (sd 0) | 6280 (sd 2.83) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | confirm-delete | baseline | 2/2 | 0 (sd 0) | 0 (sd 0) | 0 (sd 0) | 1024 (sd 0) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | confirm-delete | uninvent | 2/2 | 10 (sd 0) | 0 (sd 0) | 0 (sd 0) | 10298 (sd 14.14) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | post-filter | baseline | 2/2 | 0 (sd 0) | 1 (sd 0) | 1 (sd 0) | 902.5 (sd 2.12) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | post-filter | uninvent | 2/2 | 6 (sd 0) | 0 (sd 0) | 0 (sd 0) | 6226 (sd 24.04) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | newsletter-form | baseline | 2/2 | 0 (sd 0) | 4 (sd 0) | 4 (sd 0) | 1314 (sd 0) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | newsletter-form | uninvent | 2/2 | 5 (sd 0) | 0 (sd 0) | 0 (sd 0) | 11034 (sd 0) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | posts-empty | baseline | 2/2 | 0 (sd 0) | 0 (sd 0) | 0 (sd 0) | 859 (sd 0) | 0 (sd 0) |
| openai/gpt-4o-mini | taxonomy | posts-empty | uninvent | 2/2 | 2 (sd 0) | 0 (sd 0) | 0 (sd 0) | 6186 (sd 0) | 0 (sd 0) |

Mean and sample standard deviation use scored runs only. A run with an error is not a zero. Cost is the provider's field when it sent one.
<!-- trial-results:end -->

The table is generated from `bench/trial/results/trial.json` by `npm run trial:report`. `invent` is the wrong-component count (`uninvent check` findings). `reuse` is catalog components used in the diff. A cell that says `not scored` is an error, not a zero.

That run is [45083175529](https://github.com/raframil/uninvent/actions/runs/45083175529) (`workflow_dispatch`, status `ran`). Models `anthropic/claude-sonnet-4.5` and `openai/gpt-4o-mini`, base URL `https://openrouter.ai/api/v1`, two runs per arm. 80 runs in total. OpenRouter returned `usage.cost` on 78 of them. The sum is **$2.939951**: $2.915934 for Claude Sonnet 4.5 (38 runs) and $0.024017 for GPT-4o mini (40 runs). Means in the table are rounded to two decimals, so the mini model's per-run cost displays as 0.

`anthropic/claude-sonnet-4.5` is **pending rerun**. The 2026-11-22 rows are withheld. On that run the model spent all 6 turns on tool calls and wrote no file on 19 of 20 baseline runs (`No file was written in 6 turns`). The replies themselves were not stored, so those runs cannot be re-scored offline. Dispatch the agent-trial workflow with `models` set to `anthropic/claude-sonnet-4.5` and `runs` set to `2` after this harness fix.

`openai/gpt-4o-mini` scored all 40 runs. Those numbers are unchanged by the harness fix: the replies were not kept, and the files that were written were already scored. Baseline invent sums to 25, all raw controls, and reuse sums to 0. With uninvent, invent sums to 0 and reuse sums to 178. Invent fell on 5 of 10 tasks: shadcn-admin role-filter (1 to 0) and invite-form (4 to 0); taxonomy settings-dialog (2.5 to 0), post-filter (1 to 0), and newsletter-form (4 to 0). On the other 5, baseline invent was already 0, so uninvent did not remove findings. Reuse still rose on those tasks (both settings dialogs that were already unflagged, both confirm dialogs, and both empty states). Invent did not rise on any scored gpt-4o-mini task. The mini model's share of `usage.cost` is $0.024017 of the $2.939951 total.

## Diff excerpts

<!-- trial-excerpts:start -->
### openai/gpt-4o-mini / shadcn-admin / role-filter

Baseline, without uninvent:

```diff
diff --git a/src/features/trial/role-filter.tsx b/src/features/trial/role-filter.tsx
new file mode 100644
index 0000000..0a419ba
--- /dev/null
+++ b/src/features/trial/role-filter.tsx
@@ -0,0 +1,30 @@
+import React from 'react';
+
+type RoleFilterProps = {
+  selectedRole: string;
+  onRoleChange: (role: string) => void;
+};
+
+const roles = ['Admin', 'Member', 'Guest'];
+
+const RoleFilter: React.FC<RoleFilterProps> = ({ selectedRole, onRoleChange }) => {
+  return (
+    <div>
+      <label htmlFor="role-filter">Filter by Role:</label>
+      <select
+        id="role-filter"
+        value={selectedRole}
+        onChange={(e) => onRoleChange(e.target.value)}
+      >
+        <option value="">All</option>
+        {roles.map((role) => (
+          <option key={role} value={role}>
+            {role}
+          </option>
+        ))}
+      </select>
+    </div>
+  );
+};
+
+export default RoleFilter;
```

With uninvent (init, skill, PostToolUse hook):

```diff
diff --git a/src/features/trial/role-filter.tsx b/src/features/trial/role-filter.tsx
new file mode 100644
index 0000000..5a48f34
--- /dev/null
+++ b/src/features/trial/role-filter.tsx
@@ -0,0 +1,24 @@
+import React from 'react';
+import { Select, SelectTrigger, SelectContent, SelectItem, SelectLabel } from '@/components/ui/select';
+
+type RoleFilterProps = {
+  selectedRole: string;
+  onRoleChange: (role: string) => void;
+};
+
+const RoleFilter: React.FC<RoleFilterProps> = ({ selectedRole, onRoleChange }) => {
+  return (
+    <Select value={selectedRole} onValueChange={onRoleChange}>
+      <SelectTrigger>
+        <SelectLabel>Select Role</SelectLabel>
+      </SelectTrigger>
+      <SelectContent>
+        <SelectItem value="Admin">Admin</SelectItem>
+        <SelectItem value="Member">Member</SelectItem>
+        <SelectItem value="Guest">Guest</SelectItem>
+      </SelectContent>
+    </Select>
+  );
+};
+
+export default RoleFilter;
```

### openai/gpt-4o-mini / shadcn-admin / invite-form

Baseline, without uninvent:

```diff
diff --git a/src/features/trial/invite-form.tsx b/src/features/trial/invite-form.tsx
new file mode 100644
index 0000000..e167867
--- /dev/null
+++ b/src/features/trial/invite-form.tsx
@@ -0,0 +1,53 @@
+import React, { useState } from 'react';
+
+const InviteForm: React.FC = () => {
+    const [email, setEmail] = useState('');
+    const [role, setRole] = useState('Member');
+    const [sendEmail, setSendEmail] = useState(false);
+
+    const handleSubmit = (event: React.FormEvent) => {
+        event.preventDefault();
+        // Handle form submission logic here
+        console.log({ email, role, sendEmail });
+    };
+
+    return (
+        <form onSubmit={handleSubmit}>
+            <div>
+                <label htmlFor="email">Email:</label>
+                <input
+                    type="email"
+                    id="email"
+                    value={email}
+                    onChange={(e) => setEmail(e.target.value)}
+                    required
+                />
+            </div>
+            <div>
+                <label htmlFor="role">Role:</label>
+                <select
+                    id="role"
+                    value={role}
+                    onChange={(e) => setRole(e.target.value)}
+                >
+                    <option value="Admin">Admin</option>
+                    <option value="Member">Member</option>
+                    <option value="Guest">Guest</option>
+                </select>
+            </div>
+            <div>
+                <label>
+                    <input
+                        type="checkbox"
+                        checked={sendEmail}
+                        onChange={(e) => setSendEmail(e.target.checked)}
+                    />
+                    Send invite email
+                </label>
+            </div>
+            <button type="submit">Send invite</button>
+        </form>
+    );
+};
+
+export default InviteForm;
```

With uninvent (init, skill, PostToolUse hook):

```diff
diff --git a/src/features/trial/invite-form.tsx b/src/features/trial/invite-form.tsx
new file mode 100644
index 0000000..40b0467
--- /dev/null
+++ b/src/features/trial/invite-form.tsx
@@ -0,0 +1,69 @@
+import React, { useState } from 'react';
+import { Button } from '@/components/ui/button';
+import { Checkbox } from '@/components/ui/checkbox';
+import { Input } from '@/components/ui/input';
+import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
+import { Select, SelectTrigger, SelectContent, SelectItem, SelectLabel } from '@/components/ui/select';
+
+const InviteForm: React.FC = () => {
+  const [email, setEmail] = useState('');
+  const [role, setRole] = useState('Member');
+  const [sendEmail, setSendEmail] = useState(false);
+
+  const handleSubmit = (e: React.FormEvent) => {
+    e.preventDefault();
+    // Handle form submission logic here
+    console.log({ email, role, sendEmail });
+  };
+
+  return (
+    <Form onSubmit={handleSubmit}>
+      <FormField>
+        <FormItem>
+          <FormLabel>Email</FormLabel>
+          <FormControl>
+            <Input
+              type="email"
+              value={email}
+              onChange={(e) => setEmail(e.target.value)}
+              required
+            />
+          </FormControl>
+          <FormMessage />
+        </FormItem>
+      </FormField>
+      <FormField>
+        <FormItem>
+          <FormLabel>Role</FormLabel>
+          <FormControl>
+            <Select value={role} onValueChange={setRole}>
+              <SelectTrigger>
+                <SelectLabel>{role}</SelectLabel>
+              </SelectTrigger>
+              <SelectContent>
+                <SelectItem value="Admin">Admin</SelectItem>
+                <SelectItem value="Member">Member</SelectItem>
+                <SelectItem value="Guest">Guest</SelectItem>
+              </SelectContent>
+            </Select>
+          </FormControl>
+          <FormMessage />
+        </FormItem>
+      </FormField>
+      <FormField>
+        <FormItem>
+          <FormControl>
+            <Checkbox
+              checked={sendEmail}
+              onChange={(e) => setSendEmail(e.target.checked)}
+            />
+            <span>Send invite email</span>
+          </FormControl>
+        </FormItem>
+      </FormField>
+      <Button type="submit">Send invite</Button>
+    </Form>
+  );
+};
+
+export default InviteForm;
```
<!-- trial-excerpts:end -->

What a miss looks like on the demo app, which is the checker and not this trial:

```text
rebuilt Confirm dialog in src/components/Confirm.tsx:7, use ui/Dialog + ui/Button
reinvented loading on Button in src/components/SaveButton.tsx:11, use ui/Button loading
```

`uninvent check src/pages/Customers.tsx` prints nothing.

## Benchmark

The fixed corpus in `bench/corpus` is a separate measurement from the agent trial. 0.3.0 is the Storybook-state release. 0.4.1 is the current unpublished line: package and monorepo sources (landed as 0.4.0) and the faster hook. Counts below are generated from the result files.

<!-- bench-highlights:start -->
Taken from `bench/results/0.3.0.json` and `bench/results/0.4.1.json`. This is the fixed corpus, not the agent trial. `npm run bench` rewrites the 0.4.1 file and this section.

|  | 0.3.0 | 0.4.1 |
| --- | --- | --- |
| Raw controls | 4 / 4 | 4 / 4 |
| Recipes | 2 / 2 | 2 / 2 |
| Documented states | 6 / 6 | 6 / 6 |
| Name collisions | 2 / 2 | 2 / 2 |
| Package sources | 0 / 3 | 3 / 3 |
| Clean false positives | 0 fp / 13 | 0 fp / 13 |
| Skill tokens | 630 | 728 |
| exists tokens | 30 | 30 |
| Hook line (mean tokens) | 19.9 | 19.9 |
| Scan (ms) | 357.4 | 330.5 |
| Clean-file check (ms) | 85.2 | 37.8 |
| Hook cold p50 (ms) | 84.5 | 36.2 |
| Hook cold p95 (ms) | 86.9 | 38.8 |
| Hook warm p50 (ms) | 77.4 | 33.3 |
| Hook warm p95 (ms) | 87.2 | 34.9 |
<!-- bench-highlights:end -->

Full tables, including 0.1.0 through 0.4.0, are in [BENCHMARK.md](BENCHMARK.md).

## Run the trial

The commands and the cost budget are in [bench/trial/README.md](bench/trial/README.md). Short version, for OpenRouter:

1. Create an OpenRouter key.
2. Locally, export `UNINVENT_BENCH_API_KEY`, `UNINVENT_BENCH_BASE_URL=https://openrouter.ai/api/v1`, and `UNINVENT_BENCH_MODEL` (one id, or several separated by commas).
3. On GitHub, store the same three names. The key is a secret. The base URL and the model may be a secret or a repository variable. Dispatch `.github/workflows/agent-trial.yml` and, to compare models, set the `models` input to `anthropic/claude-sonnet-4.5, openai/gpt-4o-mini`. That input overrides `UNINVENT_BENCH_MODEL` for one run. `dry_run` replays canned files and does not need the key.
4. `npm run trial -- --write-case-study` fills the table above only when the status is `ran`.

The workflow uploads results and diffs. It does not open a pull request and it does not publish to npm. A release runs the trial only when the key is present.
