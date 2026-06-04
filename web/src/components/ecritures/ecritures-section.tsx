'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

// En-tête de section repliable au-dessus d'une liste d'écritures.
// « Bouclées » est repliée par défaut (longue) ; « À traiter » ouverte.
// Le contenu reste monté mais masqué via `hidden` quand replié — ainsi
// le sentinel d'infinite scroll de la liste ne se déclenche pas tant que
// la section est fermée (display:none ⇒ pas d'intersection).
export function EcrituresSection({
  title,
  count,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  count: number;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="mb-8">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 mb-3 text-left group/sec"
      >
        <ChevronDown
          size={16}
          strokeWidth={2.25}
          className={`text-fg-muted transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        <span className="text-[12.5px] text-fg-muted tabular-nums">
          {count} écriture{count > 1 ? 's' : ''}
        </span>
      </button>
      <div hidden={collapsed}>{children}</div>
    </section>
  );
}
