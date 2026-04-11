import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function stripFrontmatter(source: string): string {
  if (!source.startsWith("---\n")) return source;
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) return source;
  return source.slice(end + 5);
}
