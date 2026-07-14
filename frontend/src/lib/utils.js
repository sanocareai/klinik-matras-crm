import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Helper standar shadcn/ui — gabung className kondisional (clsx) lalu
// resolve konflik utility Tailwind (twMerge), dipakai semua komponen ui/*.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
