import React from "react";
import { useRovingFocus } from "./useRovingFocus";

export type TabDefinition<T extends string> = {
  value: T;
  label: string;
  id: string;
  panelId: string;
  /** Visual heading shown before the first tab of each run of equal groups. */
  group?: string;
  /** Icon-only tab; `label` becomes its accessible name and tooltip. */
  icon?: React.ReactNode;
};

/**
 * A tablist whose buttons switch tab panels. For mode pickers and filters that
 * do not own a panel, use `SegmentedControl` instead.
 */
export function Tabs<T extends string>({
  ariaLabel,
  className,
  groupClassName,
  items,
  orientation,
  tabClassName,
  value,
  onChange,
}: {
  ariaLabel: string;
  className?: string;
  groupClassName?: string;
  items: readonly TabDefinition<T>[];
  orientation?: "horizontal" | "vertical";
  tabClassName?: string;
  value: T;
  onChange: (value: T) => void;
}): React.JSX.Element {
  const roving = useRovingFocus({
    count: items.length,
    onActivate: (index) => {
      const item = items[index];
      if (item) onChange(item.value);
    },
  });

  return (
    <div
      className={className}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
    >
      {items.map((item, index) => {
        const selected = value === item.value;
        // Group headings only orient sighted users; each tab keeps its own name.
        const heading =
          item.group && item.group !== items[index - 1]?.group ? (
            <span className={groupClassName} aria-hidden="true">
              {item.group}
            </span>
          ) : null;
        return (
          <React.Fragment key={item.value}>
            {heading}
            <button
              ref={roving.register(index)}
              type="button"
              role="tab"
              id={item.id}
              aria-label={item.icon ? item.label : undefined}
              title={item.icon ? item.label : undefined}
              aria-selected={selected}
              aria-controls={item.panelId}
              tabIndex={selected ? 0 : -1}
              className={[tabClassName ?? "", selected ? "active" : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onChange(item.value)}
              onKeyDown={(event) => roving.handleKeyDown(index, event)}
            >
              {item.icon ?? item.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
