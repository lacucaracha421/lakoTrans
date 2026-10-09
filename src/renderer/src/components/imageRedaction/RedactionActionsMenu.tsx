import React from "react";
import { ActionMenu, type ActionMenuItem } from "../ui/ActionMenu";

type Props = {
  label: string;
  items: ActionMenuItem[];
  disabled: boolean;
  iconOnly?: boolean;
  align?: "start" | "end";
};

/** Feature actions share the app's menu, focus and dismissal contracts. */
export function RedactionActionsMenu(props: Props): React.JSX.Element {
  return <ActionMenu {...props} />;
}
