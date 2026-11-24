import { Button } from "./button";

export default {
  component: Button,
};

export const Loading = () => <Button loading>Save</Button>;

export const Destructive = () => <Button variant="destructive">Delete</Button>;
