import React from "react";
import * as RTooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils.js";

// Tooltip aksesibel di atas Radix (@radix-ui/react-tooltip sudah dependency).
// API ringkas: <Tooltip content="Teks"><button/></Tooltip>. Trigger memakai
// asChild supaya tidak menambah elemen bungkus ekstra.
export function Tooltip({ content, children, side = "top", delayDuration = 200, className }) {
  if (!content) return children;
  return (
    <RTooltip.Provider delayDuration={delayDuration}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            side={side}
            sideOffset={6}
            className={cn(
              "z-50 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-md",
              "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
              className
            )}
          >
            {content}
            <RTooltip.Arrow className="fill-slate-900" />
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}
