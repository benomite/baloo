import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Paperclip, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Amount } from '@/components/shared/amount';
import { DepotStatutBadge } from '@/components/depots/depot-statut-badge';
import { getCurrentContext } from '@/lib/context';
import { justifUrl } from '@/lib/justif-url';
import { isAdminRole } from '@/components/layout/nav-config';
import {
  canEditDepot,
  canViewDepot,
  getDepot,
  splitJustifPaths,
} from '@/lib/services/depots';

interface SearchParams {
  error?: string;
  updated?: string;
}

export default async function DepotDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const [sp, ctx] = await Promise.all([searchParams, getCurrentContext()]);

  const depot = await getDepot({ groupId: ctx.groupId }, id);
  if (!depot) notFound();

  const actor = { userId: ctx.userId, isAdmin: isAdminRole(ctx.role) };
  const isOwner = depot.submitted_by_user_id === ctx.userId;
  if (!canViewDepot(depot, actor)) notFound();
  const canEdit = canEditDepot(depot, actor);
  const paths = splitJustifPaths(depot.justif_paths);

  const rows: [string, React.ReactNode][] = [
    ['Date de la dépense', depot.date_estimee],
    ['Unité', depot.unite_code],
    ['Catégorie', depot.category_name],
    ['Carte utilisée', depot.carte_label],
    ['Description', depot.description],
    ['Déposé par', isOwner ? 'moi' : (depot.submitter_name ?? depot.submitter_email)],
    ['Déposé le', depot.created_at.slice(0, 10)],
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: isOwner ? 'Mes dépôts' : 'Dépôts', href: isOwner ? '/depots/mes' : '/depots' }}
        title={depot.titre}
        subtitle={depot.id}
        actions={
          canEdit ? (
            <Link href={`/depots/${depot.id}/edit`}>
              <Button>
                <Pencil size={14} strokeWidth={2} />
                Modifier
              </Button>
            </Link>
          ) : undefined
        }
      />

      {sp.error && (
        <Alert variant="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.updated && (
        <Alert variant="success" className="mb-4">
          Dépôt modifié.
        </Alert>
      )}
      {depot.statut === 'rejete' && (
        <Alert variant="error" className="mb-4">
          Dépôt rejeté{depot.motif_rejet ? ` : ${depot.motif_rejet}` : '.'}
        </Alert>
      )}

      <div className="rounded-xl border border-border-soft bg-bg-elevated p-4 space-y-3">
        <div className="flex items-center gap-3">
          <DepotStatutBadge statut={depot.statut} />
          {depot.amount_cents !== null && (
            <span className="tabular-nums font-semibold text-[16px] text-fg">
              <Amount cents={depot.amount_cents} />
            </span>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-fg-muted">{k}</dt>
                <dd className="text-fg">{v}</dd>
              </div>
            ))}
        </dl>
        {paths.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <Paperclip size={12} strokeWidth={1.75} className="text-fg-muted" />
            {paths.map((p, i) => (
              <Link
                key={p}
                href={justifUrl(p)}
                target="_blank"
                rel="noopener"
                className="text-brand hover:underline underline-offset-2"
              >
                {paths.length === 1 ? 'voir le fichier' : `fichier ${i + 1}`}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
