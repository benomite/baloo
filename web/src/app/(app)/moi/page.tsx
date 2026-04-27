import { PageHeader } from '@/components/layout/page-header';
import { getCurrentContext } from '@/lib/context';

// Espace parent / donateur (chantier 5).
// MVP : page d'accueil minimaliste qui présente les fonctionnalités à
// venir. Pas de filtre par `personne_id` côté remboursements pour
// l'instant — nécessite d'abord la migration `remboursements.personne_id`
// (sera traitée si le besoin se concrétise avec un parent réel
// connecté).
export default async function MoiPage() {
  const ctx = await getCurrentContext();

  return (
    <div className="max-w-2xl">
      <PageHeader title="Mon espace" />
      <p className="text-sm text-muted-foreground mb-6">
        Bienvenue {ctx.name ?? ctx.email}.
      </p>

      <div className="space-y-4">
        <Card title="Mes remboursements" status="à venir">
          La liste de tes demandes de remboursement et leur statut. Pour
          l&apos;instant, contacte le trésorier directement.
        </Card>

        <Card title="Mes dons & abandons de frais" status="à venir">
          Tes reçus fiscaux (CERFA) et l&apos;historique de tes dons au groupe.
        </Card>

        <Card title="Mes paiements" status="à venir">
          Les inscriptions, camps et activités de tes enfants, et leur état
          de règlement.
        </Card>
      </div>
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
