import Link from 'next/link';
import { Tag, Activity, CreditCard, Hash, ArrowRight, ExternalLink } from 'lucide-react';
import { UniteBadge } from '@/components/shared/unite-badge';
import { comptawebEcritureUrl } from '@/lib/comptaweb-url';
import type { Ecriture } from '@/lib/types';

// Résumé DENSE et lecture seule d'une écriture synchronisée (mirror /
// divergent) : pas de formulaire désactivé, juste les faits. Les champs
// Baloo-only encore éditables (notes, justif attendu) vivent dans le menu ⋯.

function Chip({ icon: Icon, children }: { icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted min-w-0">
      <Icon size={12} className="shrink-0 text-fg-subtle" />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function PanelReadonlySummary({ ecriture }: { ecriture: Ecriture }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {ecriture.unite_id ? (
          <UniteBadge code={ecriture.unite_code} name={ecriture.unite_name} couleur={ecriture.unite_couleur} />
        ) : (
          <span className="text-[12.5px] text-fg-subtle italic">sans unité</span>
        )}
        {ecriture.category_name && <Chip icon={Tag}>{ecriture.category_name}</Chip>}
        {ecriture.activite_name && <Chip icon={Activity}>{ecriture.activite_name}</Chip>}
        {ecriture.carte_porteur && (
          <Chip icon={CreditCard}>
            {ecriture.carte_type === 'procurement' ? 'Procurement' : 'CB'} · {ecriture.carte_porteur}
          </Chip>
        )}
        {ecriture.numero_piece && <Chip icon={Hash}>{ecriture.numero_piece}</Chip>}
      </div>
      {ecriture.remboursement_id && (
        <Link
          href={`/remboursements/${ecriture.remboursement_id}`}
          className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline"
        >
          Justifiée par le remboursement <code className="font-mono">{ecriture.remboursement_id}</code>
          <ArrowRight size={11} strokeWidth={2.25} />
        </Link>
      )}
      {ecriture.comptaweb_ecriture_id != null && (
        <a
          href={comptawebEcritureUrl(ecriture.comptaweb_ecriture_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline"
        >
          Ouvrir dans Comptaweb
          <ExternalLink size={11} strokeWidth={2.25} />
        </a>
      )}
    </div>
  );
}
