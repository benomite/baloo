"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { ChevronsUpDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface ComboboxItem {
  value: string
  label: string
  group?: string
}

export interface ComboboxProps {
  /** Ordre = ordre d'affichage ; `group` regroupe (sections dans l'ordre de 1re apparition). */
  items: ComboboxItem[]
  /** '' = aucune sélection. */
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  /** Libellé quand aucun résultat (défaut « Aucun résultat »). */
  emptyText?: string
  disabled?: boolean
  id?: string
  ariaLabel?: string
  /** Classes du déclencheur. */
  className?: string
}

interface ComboboxGroupShape {
  label?: string
  items: ComboboxItem[]
}

/**
 * Transforme une liste plate (avec `group?`) en sections ordonnées Base UI.
 * Les items sans `group` forment une première section sans libellé ;
 * les sections nommées suivent dans l'ordre de leur première apparition.
 */
function toGroups(items: ComboboxItem[]): ComboboxGroupShape[] {
  const ungrouped: ComboboxItem[] = []
  const order: string[] = []
  const byLabel = new Map<string, ComboboxItem[]>()

  for (const item of items) {
    if (!item.group) {
      ungrouped.push(item)
      continue
    }
    let bucket = byLabel.get(item.group)
    if (!bucket) {
      bucket = []
      byLabel.set(item.group, bucket)
      order.push(item.group)
    }
    bucket.push(item)
  }

  const groups: ComboboxGroupShape[] = []
  if (ungrouped.length > 0) {
    groups.push({ items: ungrouped })
  }
  for (const label of order) {
    groups.push({ label, items: byLabel.get(label) ?? [] })
  }
  return groups
}

export function Combobox({
  items,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText = "Aucun résultat",
  disabled,
  id,
  ariaLabel,
  className,
}: ComboboxProps) {
  const groups = React.useMemo(() => toGroups(items), [items])

  return (
    <ComboboxPrimitive.Root
      items={groups}
      value={value === "" ? null : value}
      onValueChange={(next) => onValueChange((next as string | null) ?? "")}
      disabled={disabled}
    >
      <ComboboxPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-bg-elevated py-2 pr-2.5 pl-3 text-base sm:text-[13.5px] whitespace-nowrap transition-colors outline-none select-none cursor-pointer",
          "hover:border-border-strong",
          "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
          "data-placeholder:text-fg-subtle",
          className
        )}
      >
        <span className="flex-1 truncate text-left">
          <ComboboxPrimitive.Value placeholder={placeholder} />
        </span>
        <ComboboxPrimitive.Icon
          render={
            <ChevronsUpDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
          }
        />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner sideOffset={4} className="isolate z-50 outline-none">
          <ComboboxPrimitive.Popup className="isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg shadow-fg/[0.06]">
            <ComboboxPrimitive.Input
              placeholder={searchPlaceholder}
              className="w-full border-b border-border bg-transparent px-3 py-2 text-[13.5px] outline-none placeholder:text-fg-subtle"
            />
            <ComboboxPrimitive.Empty className="px-3 py-2 text-[13.5px] text-muted-foreground">
              {emptyText}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="max-h-64 overflow-x-hidden overflow-y-auto p-1">
              {(group: ComboboxGroupShape, index: number) => (
                <ComboboxPrimitive.Group
                  key={group.label ?? `__ungrouped-${index}`}
                  items={group.items}
                  className="scroll-my-1"
                >
                  {group.label ? (
                    <ComboboxPrimitive.GroupLabel className="px-1.5 py-1 text-xs text-muted-foreground">
                      {group.label}
                    </ComboboxPrimitive.GroupLabel>
                  ) : null}
                  <ComboboxPrimitive.Collection>
                    {(item: ComboboxItem) => (
                      <ComboboxPrimitive.Item
                        key={item.value}
                        value={item.value}
                        className={cn(
                          "relative flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 px-2.5 text-[13.5px] outline-hidden select-none transition-colors",
                          "data-highlighted:bg-brand-50 data-highlighted:text-brand"
                        )}
                      >
                        {item.label}
                      </ComboboxPrimitive.Item>
                    )}
                  </ComboboxPrimitive.Collection>
                </ComboboxPrimitive.Group>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}
