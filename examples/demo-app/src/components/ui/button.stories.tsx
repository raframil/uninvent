import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { children: "Save", variant: "default" },
};

export const Destructive: Story = {
  args: { children: "Delete", variant: "destructive" },
};

export const Loading: Story = {
  args: { children: "Saving", loading: true },
};

export const Disabled: Story = {
  args: { children: "Save", disabled: true },
};
