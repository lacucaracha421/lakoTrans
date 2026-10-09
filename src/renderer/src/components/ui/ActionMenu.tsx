import React from "react";
import { IconChevronDown, IconDots } from "@tabler/icons-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { ControlTooltip } from "./ControlTooltip";
import { MenuSurface } from "./MenuSurface";
import { usePopupController } from "./usePopupController";
import styles from "./ActionMenu.module.css";

export type ActionMenuItem = {
  label: string;
  run: () => void;
  disabled?: boolean;
};

export type ActionMenuProps = {
  label: string;
  items: readonly ActionMenuItem[];
  disabled?: boolean;
  /** Icon-only trigger; defaults to the "more" dots. */
  iconOnly?: boolean;
  icon?: React.ReactNode;
  /** Leading icon for a labelled trigger. */
  triggerIcon?: React.ReactNode;
  align?: "start" | "end";
  tooltipPlacement?: "bottom" | "left" | "right" | "top";
};

/** Action menu sharing the app's menu, focus and dismissal contracts. */
export function ActionMenu({
  label,
  items,
  disabled = false,
  iconOnly,
  icon,
  triggerIcon,
  align,
  tooltipPlacement = "left",
}: ActionMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const { rootRef, triggerRef, contentRef, toggle, close, openPopup } =
    usePopupController({
      open,
      onOpenChange: setOpen,
      disabled,
      initialFocus: '[role="menuitem"]:not([disabled])',
    });
  const trigger = {
    ref: triggerRef,
    disabled,
    onClick: toggle,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "ArrowDown") return;
      event.preventDefault();
      openPopup();
    },
  };
  return (
    <div
      ref={rootRef}
      className={styles.actionMenu}
      data-align={align ?? (iconOnly ? "end" : "start")}
    >
      <ActionMenuTrigger
        trigger={trigger}
        label={label}
        iconOnly={iconOnly}
        icon={icon}
        triggerIcon={triggerIcon}
        tooltipPlacement={tooltipPlacement}
      />
      {open ? (
        <MenuSurface
          ref={contentRef}
          id={id}
          ariaLabel={label}
          className={styles.actionMenuSurface}
          onClose={close}
        >
          {items.map((item) => (
            <Button
              key={item.label}
              role="menuitem"
              variant="ghost"
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.run();
              }}
            >
              {item.label}
            </Button>
          ))}
        </MenuSurface>
      ) : null}
    </div>
  );
}

function ActionMenuTrigger({
  trigger,
  label,
  iconOnly,
  icon,
  triggerIcon,
  tooltipPlacement,
}: Pick<
  ActionMenuProps,
  "label" | "iconOnly" | "icon" | "triggerIcon" | "tooltipPlacement"
> & {
  trigger: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    ref: React.Ref<HTMLButtonElement>;
  };
}): React.JSX.Element {
  return iconOnly ? (
    <ControlTooltip content={label} placement={tooltipPlacement}>
      <IconButton {...trigger} label={label} title="">
        {icon ?? <IconDots size={18} aria-hidden="true" />}
      </IconButton>
    </ControlTooltip>
  ) : (
    <Button
      {...trigger}
      size="sm"
      variant="ghost"
      iconLeft={triggerIcon}
      iconRight={<IconChevronDown size={14} aria-hidden="true" />}
    >
      {label}
    </Button>
  );
}
