import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Mobile : text-base 16px pour empêcher iOS de zoomer au focus.
        // Desktop : 13.5px aligné sur le reste du DS.
        "flex field-sizing-content min-h-20 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-base sm:text-[13.5px] transition-colors outline-none",
        "placeholder:text-fg-subtle",
        "hover:border-border-strong",
        "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20",
        "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
