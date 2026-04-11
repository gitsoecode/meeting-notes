import * as React from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DateTimePickerProps {
  /** ISO 8601 datetime string or null. */
  value: string | null;
  /** Called with an ISO 8601 datetime string, or null when cleared. */
  onChange: (iso: string | null) => void;
  /** Label for the date field. */
  dateLabel?: string;
  /** Label for the time field. */
  timeLabel?: string;
  className?: string;
}

function toDateOnly(iso: string | null): Date | undefined {
  if (!iso) return undefined;
  try {
    return parseISO(iso);
  } catch {
    return undefined;
  }
}

function toTimeString(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = parseISO(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

export function DateTimePicker({
  value,
  onChange,
  dateLabel = "Date",
  timeLabel = "Time",
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  const selectedDate = toDateOnly(value);
  const timeValue = toTimeString(value);

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) {
      onChange(null);
      setOpen(false);
      return;
    }
    // Preserve the existing time if set, otherwise default to 09:00
    const [hh, mm] = timeValue ? timeValue.split(":").map(Number) : [9, 0];
    date.setHours(hh, mm, 0, 0);
    onChange(date.toISOString());
    setOpen(false);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = e.target.value;
    if (!time) return;
    const [hh, mm] = time.split(":").map(Number);
    const base = selectedDate ? new Date(selectedDate) : new Date();
    base.setHours(hh, mm, 0, 0);
    onChange(base.toISOString());
  };

  return (
    <FieldGroup className={className}>
      <div className="flex items-end gap-3">
        <Field>
          <FieldLabel>{dateLabel}</FieldLabel>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-40 justify-between font-normal"
              >
                {selectedDate ? format(selectedDate, "MMM d, yyyy") : "Select date"}
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                defaultMonth={selectedDate}
                onSelect={handleDateSelect}
              />
            </PopoverContent>
          </Popover>
        </Field>
        <Field className="w-32">
          <FieldLabel>{timeLabel}</FieldLabel>
          <Input
            type="time"
            value={timeValue}
            onChange={handleTimeChange}
            className="appearance-none bg-white [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
          />
        </Field>
      </div>
    </FieldGroup>
  );
}
