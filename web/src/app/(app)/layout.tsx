import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { HelpFooter } from '@/components/layout/help-footer';
import { getCurrentContext } from '@/lib/context';

// Layout des pages authentifiées (chantier 4 ADR-016 + chantier 5).
// `getCurrentContext` redirige vers `/login` si pas de session, et
// fournit le rôle pour adapter la sidebar.
//
// Sur desktop (lg+), sidebar fixe à gauche. Sur mobile (<lg), sidebar
// cachée par défaut, accessible via le bouton burger d'une top-bar
// mobile (`MobileNav`).
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentContext();

  return (
    // `flex-col` sur mobile : top-bar mobile (de MobileNav) au-dessus,
    // main en dessous. `lg:flex-row` sur desktop : sidebar à gauche,
    // main à droite.
    <div className="flex flex-col lg:flex-row flex-1 min-w-0">
      {/* Top-bar mobile + drawer (<lg). Sur lg+ ses éléments sont
          tous `lg:hidden` donc consomment 0 espace. */}
      <MobileNav>
        <Sidebar role={ctx.role} />
      </MobileNav>

      {/* Sidebar fixe desktop (lg+) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[260px] lg:shrink-0 border-r border-border bg-bg-sunken/60">
        <Sidebar role={ctx.role} />
      </aside>

      {/* Contenu principal */}
      <main className="flex-1 overflow-auto px-4 py-5 lg:px-8 lg:py-7 min-w-0">
        {children}
        <div className="max-w-6xl mx-auto">
          <HelpFooter groupId={ctx.groupId} selfEmail={ctx.email} />
        </div>
      </main>
    </div>
  );
}
