'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// `<MobileNav>` : top-bar visible uniquement sur mobile (`<lg`) avec
// bouton burger qui ouvre la sidebar en drawer slide-in. La sidebar
// elle-même est passée en `children` — sur desktop elle reste rendue
// inline par le layout, sur mobile ce wrapper la masque dans un
// drawer overlay.
//
// L'état "open" est local. Le drawer se ferme automatiquement au
// changement de page (utile pour les liens de la sidebar).

interface MobileNavProps {
  /** Le `<Sidebar>` complet — on le rend dans le drawer. */
  children: React.ReactNode;
  /** Logo / titre dans la top-bar mobile (ex: "Baloo"). */
  brand?: React.ReactNode;
}

export function MobileNav({ children, brand }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Fermer automatiquement au changement de route. Le linter
  // (`react-hooks/set-state-in-effect`) signale ce pattern, mais ici
  // c'est explicitement ce qu'on veut : un effet de bord côté UI sur
  // la navigation, pas un setState pendant le rendu.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  // Bloquer le scroll du body quand le drawer est ouvert.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  // Échap pour fermer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Top-bar mobile (sticky) — visible <lg uniquement. */}
      <header className="lg:hidden sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-bg/95 backdrop-blur px-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le menu"
          className="-ml-1.5 p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-fg/[0.05] transition-colors"
        >
          <Menu size={18} strokeWidth={2} />
        </button>
        <div className="text-[14px] font-semibold tracking-tight text-fg">
          {brand ?? 'Baloo'}
        </div>
      </header>

      {/* Drawer overlay — visible <lg uniquement, quand open. */}
      <div
        className={cn(
          'lg:hidden fixed inset-0 z-50 transition-opacity',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden={!open}
      >
        {/* Overlay click-outside */}
        <div
          className="absolute inset-0 bg-fg/40 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        />

        {/* Drawer slide-in */}
        <aside
          className={cn(
            'absolute left-0 top-0 h-full w-[260px] bg-bg-sunken border-r border-border shadow-xl shadow-fg/10 transition-transform duration-150',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navigation"
        >
          {/* Bouton fermer en haut à droite du drawer */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fermer le menu"
            className="absolute top-3 right-3 z-10 p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-fg/[0.05] transition-colors"
          >
            <X size={16} strokeWidth={2} />
          </button>
          {children}
        </aside>
      </div>
    </>
  );
}
