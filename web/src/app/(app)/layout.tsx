import { Sidebar } from '@/components/layout/sidebar';
import { getCurrentContext } from '@/lib/context';

// Layout des pages authentifiées (chantier 4 ADR-016 + chantier 5).
// `getCurrentContext` redirige vers `/login` si pas de session, et
// fournit le rôle pour adapter la sidebar.
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentContext();

  return (
    <>
      <Sidebar role={ctx.role} />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </>
  );
}
