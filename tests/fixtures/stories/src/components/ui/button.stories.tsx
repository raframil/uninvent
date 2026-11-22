import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  args: { size: "sm" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { children: "Save", variant: "default", size: "default" },
};

export const Destructive: Story = {
  args: { children: "Delete", variant: "destructive" },
};

export const Loading: Story = {
  render: () => <Button loading>Saving</Button>,
};

export const Disabled: Story = {
  args: { disabled: true },
};

const Template = (args: { children?: string }) => <Button {...args} />;

export const Busy = Template.bind({});
Busy.args = { children: "Wait" };
