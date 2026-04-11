import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium text-[var(--text-primary)]",
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "absolute left-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 text-[var(--text-primary)]"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "absolute right-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 text-[var(--text-primary)]"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "text-[var(--text-tertiary)] rounded-md w-9 font-normal text-[0.8rem] text-center",
        week: "flex w-full mt-2",
        day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 h-9 w-9",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] aria-selected:opacity-100"
        ),
        selected:
          "bg-[var(--accent)] text-white rounded-md [&>button]:bg-[var(--accent)] [&>button]:text-white [&>button]:hover:bg-[var(--accent)] [&>button]:hover:text-white [&>button]:focus:bg-[var(--accent)] [&>button]:focus:text-white",
        today: "[&>button]:bg-[var(--bg-secondary)] [&>button]:text-[var(--text-primary)]",
        outside:
          "text-[var(--text-tertiary)] [&>button]:text-[var(--text-tertiary)] aria-selected:bg-[var(--accent)]/10 aria-selected:text-[var(--text-tertiary)]",
        disabled: "text-[var(--text-tertiary)] opacity-50",
        range_middle: "aria-selected:bg-[var(--accent)]/10 aria-selected:text-[var(--text-primary)]",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
          return <Icon className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
