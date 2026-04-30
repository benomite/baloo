import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Sur mobile : font-size 16px pour empêcher iOS de zoomer au
        // focus. Sur desktop (sm+) : on revient à 13.5px qui matche le
        // body.
        "h-10 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-base sm:text-[13.5px] transition-colors outline-none",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "placeholder:text-fg-subtle",
        "hover:border-border-strong",
        "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
