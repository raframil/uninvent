import * as React from "react";

export interface AlertProps {
  tone?: "info" | "warning";
  title?: string;
}

export declare const Alert: React.FC<AlertProps>;
