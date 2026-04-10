import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

function isCheckedState(value: CheckboxProps["checked"]) {
  return value === true || value === "indeterminate";
}

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ checked, className, disabled, style, ...props }, ref) => {
  const active = isCheckedState(checked);

  return (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      disabled={disabled}
      className={cn("transition-colors focus-visible:outline-none disabled:cursor-not-allowed", className)}
      style={{
        all: "unset",
        boxSizing: "border-box",
        width: 16,
        height: 16,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        borderRadius: 4,
        border: `1px solid ${active ? "var(--accent)" : "var(--border-default)"}`,
        backgroundColor: active ? "var(--accent)" : "white",
        color: "white",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        boxShadow: "none",
        verticalAlign: "middle",
        ...style,
      }}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        forceMount
        style={{
          display: active ? "flex" : "none",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
        }}
      >
        <Check style={{ width: 12, height: 12 }} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

Checkbox.displayName = CheckboxPrimitive.Root.displayName;
