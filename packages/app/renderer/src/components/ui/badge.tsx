import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
  {
    variants: {
      variant: {
        neutral: "bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
        accent: "bg-[var(--accent-muted)] text-[var(--accent)]",
        success: "bg-[var(--success-muted)] text-[var(--success)]",
        warning: "bg-[var(--warning-muted)] text-[var(--warning-text)]",
        destructive: "bg-[var(--error-muted)] text-[var(--error)]",
        info: "bg-[var(--info-muted)] text-[var(--info)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
