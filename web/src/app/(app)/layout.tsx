import { Sidebar } from '@/components/layout/sidebar';
import { auth } from '@/lib/auth/auth';
import { redirect } from 'next/navigation';

// Layout des pages authentifiées (chantier 4, ADR-014).
// Toute page sous `(app)/` redirige vers `/login` si pas de session.
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </>
  );
}
