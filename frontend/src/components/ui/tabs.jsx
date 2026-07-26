import React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils.js";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex items-center gap-1 rounded-2xl bg-inset/80 p-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "rounded-xl px-3.5 py-1.5 text-sm font-medium text-ink2 transition-all",
        "hover:text-accent",
        "data-[state=active]:bg-surface data-[state=active]:text-accent data-[state=active]:shadow-card",
        className
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
