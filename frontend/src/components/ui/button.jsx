import React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-brand-600 text-white hover:bg-brand-700",
        outline: "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        ghost:   "text-slate-500 hover:bg-slate-100",
        // Aksi destruktif (hapus, batalkan). JANGAN dipakai utk aksi biasa.
        danger:  "bg-chart-rose text-white hover:bg-red-700",
        // HANYA untuk aksi AI (Tanya Sano, buat draf balasan). Gradient di-reserve
        // supaya sinyal "ini AI" tidak luntur — lihat sano-color-system.md §3.
        ai:      "bg-ai-gradient text-white hover:opacity-95",
      },
      size: {
        default: "h-9 px-4",
        sm:      "h-8 px-3 text-xs",
        lg:      "h-10 px-5",
        icon:    "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export function Button({ className, variant, size, asChild, ...props }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
