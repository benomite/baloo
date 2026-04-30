import { cn } from '@/lib/utils';

// `<NativeSelect>` : `<select>` HTML stylé selon le design system.
// Préféré au `<Select>` shadcn/@base-ui dans les `<form action={...}>`
// Next.js, parce qu'il fait remonter directement sa valeur dans
// `FormData` sans avoir à passer par un input hidden.
//
// Pour des cas avec UI riche (groupes, items custom, recherche), utilise
// le `<Select>` shadcn ou le wrapper `<SelectField>`.

export function NativeSelect({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={cn(
          'h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-9 text-base sm:text-[13.5px] outline-none transition-colors',
          'hover:border-border-strong',
          'focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20',
          'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
          className,
        )}
      />
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle"
      >
        <path
          d="m6 8 4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
