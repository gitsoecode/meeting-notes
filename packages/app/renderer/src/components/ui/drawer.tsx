import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "./dialog";
import { cn } from "@/lib/utils";

export const Drawer = Dialog;
export const DrawerTrigger = DialogTrigger;
export const DrawerClose = DialogClose;
export const DrawerHeader = DialogHeader;
export const DrawerTitle = DialogTitle;
export const DrawerDescription = DialogDescription;
export const DrawerFooter = DialogFooter;

export function DrawerContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return <DialogContent className={cn("max-h-[90vh] overflow-hidden p-0 sm:max-w-[32rem]", className)} {...props} />;
}
