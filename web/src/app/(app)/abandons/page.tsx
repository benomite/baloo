import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { listAbandons } from '@/lib/services/abandons';
import { toggleCerfaEmis } from '@/lib/actions/abandons';
import { Amount } from '@/components/shared/amount';

interface SearchParams {
  error?: string;
}

export default async function AbandonsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const params = await searchParams;
  const abandons = await listAbandons({ groupId: ctx.groupId }, { limit: 200 });

  // Groupé par année fiscale.
  const byYear = new Map<string, typeof abandons>();
  for (const a of abandons) {
    const list = byYear.get(a.annee_fiscale) ?? [];
    list.push(a);
    byYear.set(a.annee_fiscale, list);
  }
  const years = [...byYear.keys()].sort().reverse();

  return (
    <div>
      <PageHeader title="Abandons de frais" />

      {params.error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {params.error}
        </p>
      )}

      {abandons.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun abandon de frais déclaré.</p>
      ) : (
        years.map((year) => {
          const items = byYear.get(year)!;
          const total = items.reduce((s, a) => s + a.amount_cents, 0);
          return (
            <section key={year} className="mb-8">
              <h2 className="font-semibold mb-2">
                {year} <span className="text-sm text-muted-foreground">— total <Amount cents={total} /></span>
              </h2>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4">Réf.</th>
                    <th className="py-2 pr-4">Donateur</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Nature</th>
                    <th className="py-2 pr-4 text-right">Montant</th>
                    <th className="py-2 pr-4">Unité</th>
                    <th className="py-2 pr-4">CERFA</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="py-2 pr-4 font-mono text-xs">{a.id}</td>
                      <td className="py-2 pr-4">{a.donateur}</td>
                      <td className="py-2 pr-4">{a.date_depense}</td>
                      <td className="py-2 pr-4">{a.nature}</td>
                      <td className="py-2 pr-4 text-right font-medium"><Amount cents={a.amount_cents} /></td>
                      <td className="py-2 pr-4">{a.unite_code ?? '—'}</td>
                      <td className="py-2 pr-4">
                        <form action={toggleCerfaEmis}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="cerfa_emis" value={a.cerfa_emis ? '0' : '1'} />
                          {a.cerfa_emis ? (
                            <Button type="submit" variant="outline" size="sm">✓ Émis (annuler)</Button>
                          ) : (
                            <Button type="submit" size="sm">Marquer émis</Button>
                          )}
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })
      )}
    </div>
  );
}
