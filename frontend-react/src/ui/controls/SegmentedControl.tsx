import type {ButtonHTMLAttributes, HTMLAttributes} from "react";
import {joinClasses} from "./joinClasses";

export function SegmentedControl({className, ...props}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role={props.role ?? "group"} className={joinClasses("ui-segmented", className)} />;
}

export function SegmentedItem({
  selected,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {selected: boolean}) {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={joinClasses("ui-segmented__item", selected && "is-selected", className)}
    />
  );
}
