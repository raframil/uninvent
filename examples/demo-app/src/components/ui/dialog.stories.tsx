import type { Meta, StoryObj } from "@storybook/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

const meta = {
  title: "UI/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Happy path only. Loading and error states are intentionally absent. */
export const Open: Story = {
  render: () => (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Invite a teammate</DialogTitle>
        <DialogDescription>They get access to this workspace.</DialogDescription>
      </DialogContent>
    </Dialog>
  ),
};
