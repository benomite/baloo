import { PageHeader } from '@/components/layout/page-header';
import { TabLink } from '@/components/shared/tab-link';
import { Section } from '@/components/shared/section';
import { listBudgets, listBudgetLignes } from '@/lib/services/budgets';
import { listCategories, listUnites, listActivites } from '@/lib/queries/reference';
import { currentExercice } from '@/lib/services/overview';
import { getCurrentContext } from '@/lib/context';
import { ensureBudgetForSaisonAction } from '@/lib/actions/budgets';
import { BudgetForm } from '@/components/budgets/budget-form';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface SearchParams { saison?: string }

function saisonOptions(): { value: string; label: string }[] {
  const cur = currentExercice();
  const curStart = parseInt(cur.split('-')[0], 10);
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const y = curStart - i;
    opts.push({ value: `${y}-${y + 1}`, label: `Sept ${y} → Août ${y + 1}` });
  }
  return opts;
}

const ADMIN_ROLES = ['tresorier', 'RG'];

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect('/synthese');
  }
  const sp = await searchParams;
  const saison = sp.saison ?? currentExercice();

  const [budgets, categories, unites, activites] = await Promise.all([
    listBudgets({ groupId: ctx.groupId }, { saison }),
    listCategories(),
    listUnites(),
    listActivites(),
  ]);
  const budget = budgets[0] ?? null;
  const lignesData = budget
    ? await listBudgetLignes({ groupId: ctx.groupId }, budget.id)
    : { lignes: [], total_depenses_cents: 0, total_recettes_cents: 0, solde_cents: 0 };

  const options = saisonOptions();

  return (
    <div>
      <PageHeader
        title="Budget"
        subtitle="Saisie et suivi du budget prévisionnel par saison, unité et activité."
      />

      <div className="mb-4 flex flex-wrap gap-6 border-b">
        {options.map((o) => (
          <TabLink key={o.value} href={`/budgets?saison=${o.value}`} active={saison === o.value}>
            {o.label}
          </TabLink>
        ))}
      </div>

      {!budget ? (
        <Section title={`Saison ${saison}`} className="mb-8">
          <p className="text-sm text-muted-foreground mb-4">
            Pas encore de budget pour cette saison.
          </p>
          <form
            action={async () => {
              'use server';
              await ensureBudgetForSaisonAction(saison);
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-brand text-white px-3 py-1.5 text-sm hover:bg-brand/90"
            >
              Créer le budget {saison}
            </button>
          </form>
        </Section>
      ) : (
        <BudgetForm
          budget={budget}
          lignes={lignesData.lignes}
          totaux={{
            depenses: lignesData.total_depenses_cents,
            recettes: lignesData.total_recettes_cents,
            solde: lignesData.solde_cents,
          }}
          categories={categories}
          unites={unites}
          activites={activites}
          readOnly={budget.statut === 'cloture'}
        />
      )}
    </div>
  );
}
