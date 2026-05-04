import { notFound } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Landmark, Lock, Mail } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { JustificatifsCard } from '@/components/ecritures/justificatifs-card';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { PendingButton } from '@/components/shared/pending-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentContext } from '@/lib/context';
import { getEcriture } from '@/lib/queries/ecritures';
import { listJustificatifsForEcriture } from '@/lib/queries/justificatifs';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes, getTopCategoryIds } from '@/lib/queries/reference';
import { updateEcriture, updateEcritureStatus } from '@/lib/actions/ecritures';
import { listDepots } from '@/lib/services/depots';
import { computeReadiness } from '@/lib/sync-readiness';
import { sendRelance } from '@/lib/actions/relances';
import { SyncDraftButton } from '@/components/ecritures/sync-draft-button';
import { Amount } from '@/components/shared/amount';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';

interface SearchParams {
  error?: string;
  relanced?: string;
}

const ADMIN_ROLES = ['tresorier', 'RG'];

export default async function EcritureDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;

  // Tout est indépendant (ou seulement dépendant de l'id que params
  // a déjà résolu). On lance en parallèle pour ne payer qu'un RTT.
  const [
    sp,
    ctx,
    ecriture,
    justifsBundle,
    categories,
    topCategoryIds,
    unites,
    modesPaiement,
    activites,
    cartes,
  ] = await Promise.all([
    searchParams,
    getCurrentContext(),
    getEcriture(id),
    listJustificatifsForEcriture(id),
    listCategories(),
    getTopCategoryIds(5),
    listUnites(),
    listModesPaiement(),
    listActivites(),
    listCartes(),
  ]);
  // Dépend de ctx donc en 2e temps. Volume attendu très faible.
  const pendingDepots = await listDepots(
    { groupId: ctx.groupId },
    { statut: 'a_traiter' },
  );
  if (!ecriture) notFound();
  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const totalJustifs =
    justifsBundle.direct.length +
    justifsBundle.viaRemboursement.reduce((sum, r) => sum + r.justifs.length + r.rib.length, 0);
  const updateAction = updateEcriture.bind(null, id);
  const noJustif = totalJustifs === 0 && ecriture.justif_attendu !== 0;
  const justifMissing =
    ecriture.type === 'depense' &&
    ecriture.justif_attendu === 1 &&
    totalJustifs === 0;
  const readiness = computeReadiness(ecriture, {
    categories,
    unites,
    modesPaiement,
    activites,
  });

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Écritures', href: '/ecritures' }}
        title={ecriture.id}
        subtitle={cleanDescription(ecriture.description)}
        meta={
          <>
            <EcritureStatusBadge status={ecriture.status} />
            <Amount
              cents={ecriture.amount_cents}
              tone={ecriture.type === 'depense' ? 'negative' : 'positive'}
              className="text-[22px] font-semibold tracking-tight"
            />
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ecriture.status === 'brouillon' && (
              <form action={updateEcritureStatus.bind(null, id, 'valide')}>
                <PendingButton variant="outline" size="sm">
                  Valider
                </PendingButton>
              </form>
            )}
            {ecriture.status === 'valide' && !ecriture.comptaweb_ecriture_id && (
              <form action={updateEcritureStatus.bind(null, id, 'saisie_comptaweb')}>
                <PendingButton variant="outline" size="sm">
                  Marquer saisie Comptaweb (sans sync)
                </PendingButton>
              </form>
            )}
            {/* Sync Comptaweb : tant que l'écriture n'a pas d'ID CW, on
                propose la sync, peu importe son status (brouillon, valide,
                saisie_comptaweb par erreur). */}
            {!ecriture.comptaweb_ecriture_id && <SyncDraftButton ecritureId={id} />}
            {/* Repasser en brouillon : pratique pour réparer un statut
                avancé à tort. Verrouillé si l'écriture est vraiment
                dans Comptaweb. */}
            {ecriture.status !== 'brouillon' && !ecriture.comptaweb_ecriture_id && (
              <form action={updateEcritureStatus.bind(null, id, 'brouillon')}>
                <PendingButton variant="ghost" size="sm">
                  Repasser en brouillon
                </PendingButton>
              </form>
            )}
          </div>
        }
      />

      {ecriture.ligne_bancaire_id && (
        <Alert variant="info" icon={Landmark} className="mb-6">
          Issue de la ligne bancaire Comptaweb{' '}
          <code className="font-mono text-[12.5px] font-medium">
            #{ecriture.ligne_bancaire_id}
          </code>
          {ecriture.ligne_bancaire_sous_index !== null && (
            <>
              {' '}sous-ligne{' '}
              <code className="font-mono text-[12.5px] font-medium">
                {ecriture.ligne_bancaire_sous_index}
              </code>
              {' '}(paiement carte multi-commerçants)
            </>
          )}
          {ecriture.comptaweb_ecriture_id && (
            <>
              {' '}· Synchronisée vers Comptaweb (id{' '}
              <code className="font-mono text-[12.5px] font-medium">
                {ecriture.comptaweb_ecriture_id}
              </code>
              )
            </>
          )}
        </Alert>
      )}

      <ReadinessBanner readiness={readiness} justifMissing={justifMissing} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(280px,320px)] gap-6 items-start">
        <EcritureForm
          action={updateAction}
          categories={categories}
          topCategoryIds={topCategoryIds}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
          ecriture={ecriture}
        />

        <aside className="lg:sticky lg:top-6 space-y-4">
          <JustificatifsCard
            entityId={id}
            bundle={justifsBundle}
            justifAttendu={ecriture.justif_attendu === 1}
            numeroPiece={ecriture.numero_piece}
            type={ecriture.type}
            pendingDepots={pendingDepots}
            ecritureAmountCents={ecriture.amount_cents}
            ecritureDate={ecriture.date_ecriture}
          />
          {noJustif && isAdmin && (
            <RelanceCard
              ecritureId={id}
              relancedTo={sp.relanced}
              error={sp.error}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// Nettoie un libellé bancaire brut pour l'affichage : retire les
// espaces multiples, met une casse plus humaine.
function cleanDescription(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function ReadinessBanner({
  readiness,
  justifMissing,
}: {
  readiness: ReturnType<typeof computeReadiness>;
  justifMissing: boolean;
}) {
  if (readiness.level === 'synced') {
    return (
      <div className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20 px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-emerald-800 dark:text-emerald-300">
          <Lock size={14} strokeWidth={2.25} />
          {readiness.message}
        </div>
        <p className="text-[12px] text-emerald-700/90 dark:text-emerald-400/80 mt-0.5 ml-6">
          Les champs synchronisables sont verrouillés.
        </p>
      </div>
    );
  }
  if (readiness.level === 'ready') {
    return (
      <div className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20 px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 size={14} strokeWidth={2.25} />
          {readiness.message}
        </div>
        <p className="text-[12px] text-emerald-700/90 dark:text-emerald-400/80 mt-0.5 ml-6">
          Tous les champs requis sont mappés Comptaweb.
          {justifMissing && ' Justificatif manquant (non bloquant pour la sync).'}
        </p>
      </div>
    );
  }
  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-amber-900 dark:text-amber-300 mb-1.5">
        <AlertTriangle size={14} strokeWidth={2.25} />
        À compléter avant synchronisation Comptaweb
      </div>
      <ul className="ml-6 space-y-0.5">
        {readiness.missingFields.map((m) => (
          <li
            key={m}
            className="text-[12.5px] text-amber-900 dark:text-amber-200 list-disc list-inside"
          >
            {m}
          </li>
        ))}
        {justifMissing && (
          <li className="text-[12.5px] text-amber-700 dark:text-amber-300/80 list-disc list-inside italic">
            justificatif (non bloquant pour sync, mais à fournir)
          </li>
        )}
      </ul>
    </div>
  );
}

function RelanceCard({
  ecritureId,
  relancedTo,
  error,
}: {
  ecritureId: string;
  relancedTo?: string;
  error?: string;
}) {
  return (
    <Section title="Relancer pour le justif" subtitle="Envoyer un email à la personne concernée.">
      {relancedTo && (
        <Alert variant="success" className="text-[12px]">
          Relance envoyée à <b>{relancedTo}</b>.
        </Alert>
      )}
      {error && (
        <Alert variant="error" className="text-[12px]">
          {error}
        </Alert>
      )}
      <form action={sendRelance} className="space-y-3">
        <input type="hidden" name="ecriture_id" value={ecritureId} />
        <Field label="Destinataire" htmlFor="destinataire" required>
          <Input
            id="destinataire"
            name="destinataire"
            type="email"
            required
            placeholder="prenom@example.fr"
          />
        </Field>
        <Field label="Message" htmlFor="message" hint="optionnel">
          <Textarea
            id="message"
            name="message"
            rows={2}
            placeholder="Ex. Peux-tu me transmettre la facture stp ?"
          />
        </Field>
        <div className="flex justify-end">
          <PendingButton size="sm" pendingLabel="Envoi…">
            <Mail size={14} strokeWidth={2} className="mr-1.5" />
            Envoyer la relance
          </PendingButton>
        </div>
      </form>
    </Section>
  );
}
