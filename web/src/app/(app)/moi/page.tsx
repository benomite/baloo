import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { getCurrentContext } from '@/lib/context';
import { listRemboursements } from '@/lib/services/remboursements';
import { listAbandons } from '@/lib/services/abandons';
import { formatAmount } from '@/lib/format';

interface SearchParams {
  error?: string;
  rbt_created?: string;
  abandon_created?: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  demande: { label: 'En attente', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  valide: { label: 'Validée', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  paye: { label: 'Payée', cls: 'bg-green-100 text-green-800 border-green-200' },
  refuse: { label: 'Refusée', cls: 'bg-red-100 text-red-800 border-red-200' },
};

export default async function MoiPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getCurrentContext();
  const params = await searchParams;
  const canRequest = ctx.role !== 'parent';

  const myRbts = canRequest
    ? await listRemboursements({ groupId: ctx.groupId, submittedByUserId: ctx.userId }, { limit: 20 })
    : [];
  const myAbandons = canRequest
    ? await listAbandons({ groupId: ctx.groupId, submittedByUserId: ctx.userId }, { limit: 20 })
    : [];

  return (
    <div className="max-w-2xl">
      <PageHeader title="Mon espace" />
      <p className="text-sm text-muted-foreground mb-6">
        Bienvenue {ctx.name ?? ctx.email}.
      </p>

      {params.error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {params.error}
        </p>
      )}
      {params.rbt_created && (
        <p className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Demande <b>{params.rbt_created}</b> envoyée. Tu recevras un email à chaque étape.
        </p>
      )}
      {params.abandon_created && (
        <p className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Abandon <b>{params.abandon_created}</b> déclaré. Le trésorier émettra le reçu fiscal.
        </p>
      )}

      <div className="space-y-4">
        {canRequest ? (
          <RemboursementsCard rbts={myRbts} />
        ) : (
          <Card title="Mes remboursements" status="lecture seule">
            En tant que parent, tu peux suivre tes propres demandes de remboursement de
            cotisations / inscriptions ici. Pour l&apos;instant, contacte le trésorier directement.
          </Card>
        )}

        {canRequest ? (
          <AbandonsCard abandons={myAbandons} />
        ) : (
          <Card title="Mes dons & abandons de frais" status="à venir">
            Tes reçus fiscaux (CERFA) et l&apos;historique de tes dons au groupe.
          </Card>
        )}

        <Card title="Mes paiements" status="à venir">
          Les inscriptions, camps et activités de tes enfants, et leur état de règlement.
        </Card>
      </div>
    </div>
  );
}

function RemboursementsCard({
  rbts,
}: {
  rbts: Awaited<ReturnType<typeof listRemboursements>>;
}) {
  return (
    <div className="rounded border border-muted bg-muted/20 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-semibold">Mes remboursements</h2>
        <Link href="/moi/remboursements/nouveau">
          <Button size="sm">Nouvelle demande</Button>
        </Link>
      </div>

      {rbts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tu n&apos;as encore fait aucune demande. Si tu as avancé des frais pour le groupe, clique
          sur « Nouvelle demande ».
        </p>
      ) : (
        <ul className="space-y-2">
          {rbts.map((r) => {
            const st = STATUS_LABEL[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-800 border-gray-200' };
            return (
              <li key={r.id} className="flex items-center gap-3 text-sm border rounded px-3 py-2 bg-background">
                <span className={`text-xs px-2 py-0.5 rounded border ${st.cls}`}>{st.label}</span>
                <div className="flex-1">
                  <div className="font-medium">{r.nature}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.id} · {r.date_depense}
                    {r.date_paiement ? ` · payé le ${r.date_paiement}` : ''}
                  </div>
                </div>
                <span className="font-semibold">{formatAmount(r.amount_cents)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AbandonsCard({
  abandons,
}: {
  abandons: Awaited<ReturnType<typeof listAbandons>>;
}) {
  return (
    <div className="rounded border border-muted bg-muted/20 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-semibold">Mes dons (abandons de frais)</h2>
        <Link href="/moi/abandons/nouveau">
          <Button size="sm" variant="outline">Nouveau don</Button>
        </Link>
      </div>

      {abandons.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tu n&apos;as fait aucun don déclaré. Si tu souhaites renoncer au remboursement de frais
          que tu as avancés (et recevoir un reçu fiscal), clique sur « Nouveau don ».
        </p>
      ) : (
        <ul className="space-y-2">
          {abandons.map((a) => (
            <li key={a.id} className="flex items-center gap-3 text-sm border rounded px-3 py-2 bg-background">
              <span
                className={`text-xs px-2 py-0.5 rounded border ${
                  a.cerfa_emis
                    ? 'bg-green-100 text-green-800 border-green-200'
                    : 'bg-amber-100 text-amber-800 border-amber-200'
                }`}
              >
                {a.cerfa_emis ? 'CERFA émis' : 'En attente'}
              </span>
              <div className="flex-1">
                <div className="font-medium">{a.nature}</div>
                <div className="text-xs text-muted-foreground">
                  {a.id} · {a.date_depense} · année fiscale {a.annee_fiscale}
                </div>
              </div>
              <span className="font-semibold">{formatAmount(a.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-muted bg-muted/20 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground italic">{status}</span>
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
