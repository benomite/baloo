import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CreditCard, Landmark, Mail, Paperclip } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { PendingButton } from '@/components/shared/pending-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentContext } from '@/lib/context';
import { getEcriture } from '@/lib/queries/ecritures';
import {
  listJustificatifsForEcriture,
  type EcritureJustifsBundle,
} from '@/lib/queries/justificatifs';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes, getTopCategoryIds } from '@/lib/queries/reference';
import { updateEcriture, updateEcritureStatus } from '@/lib/actions/ecritures';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
import { attachDepotFromEcriture } from '@/lib/actions/depots';
import { listDepots, type DepotEnriched } from '@/lib/services/depots';
import { sendRelance } from '@/lib/actions/relances';
import { NativeSelect } from '@/components/ui/native-select';
import { formatAmount } from '@/lib/format';
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
              <>
                <form action={updateEcritureStatus.bind(null, id, 'valide')}>
                  <PendingButton variant="outline" size="sm">
                    Valider
                  </PendingButton>
                </form>
                <SyncDraftButton ecritureId={id} />
              </>
            )}
            {ecriture.status === 'valide' && (
              <form action={updateEcritureStatus.bind(null, id, 'saisie_comptaweb')}>
                <PendingButton variant="outline" size="sm">
                  Marquer saisie Comptaweb
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

function JustificatifsCard({
  entityId,
  bundle,
  justifAttendu,
  numeroPiece,
  type,
  pendingDepots,
  ecritureAmountCents,
  ecritureDate,
}: {
  entityId: string;
  bundle: EcritureJustifsBundle;
  justifAttendu: boolean;
  numeroPiece: string | null;
  type: 'depense' | 'recette';
  pendingDepots: DepotEnriched[];
  ecritureAmountCents: number;
  ecritureDate: string;
}) {
  // Classement suggestions / autres : même règle que côté /depots,
  // mais inversée (matching d'un dépôt avec l'écriture courante).
  const tolMontant = Math.max(100, Math.round(Math.abs(ecritureAmountCents) * 0.1));
  const ecritureDay = new Date(ecritureDate + 'T00:00:00Z').getTime();
  const matches = (d: DepotEnriched) => {
    if (d.amount_cents !== null && Math.abs(d.amount_cents - Math.abs(ecritureAmountCents)) > tolMontant) {
      return false;
    }
    if (d.date_estimee) {
      const dDay = new Date(d.date_estimee + 'T00:00:00Z').getTime();
      if (Math.abs(dDay - ecritureDay) > 15 * 86_400_000) return false;
    }
    return true;
  };
  const suggestions = pendingDepots.filter(matches);
  const suggestionIds = new Set(suggestions.map((d) => d.id));
  const otherDepots = pendingDepots.filter((d) => !suggestionIds.has(d.id));
  const depotLabel = (d: DepotEnriched) => {
    const titre = d.titre.length > 40 ? d.titre.slice(0, 40) + '…' : d.titre;
    const montant = d.amount_cents !== null ? formatAmount(d.amount_cents) : '—';
    const date = d.date_estimee ?? '?';
    return `${date} · ${montant} · ${titre}`;
  };
  const totalCount =
    bundle.direct.length +
    bundle.viaRemboursement.reduce((sum, r) => sum + r.justifs.length + r.rib.length, 0);

  return (
    <Section
      title={`Justificatifs (${totalCount})`}
      subtitle={!justifAttendu ? 'Non requis pour cette écriture' : undefined}
    >
      {totalCount === 0 && (
        <>
          {!justifAttendu && (
            <Alert variant="info" icon={null}>
              Justificatif non attendu (prélèvement auto / flux territoire).
            </Alert>
          )}
          {justifAttendu && numeroPiece && (
            <Alert variant="warning">
              En attente — code Comptaweb{' '}
              <code className="font-mono text-[12.5px]">{numeroPiece}</code>{' '}
              renseigné, document à rattacher.
            </Alert>
          )}
          {justifAttendu && !numeroPiece && type === 'depense' && (
            <Alert variant="warning">Justificatif manquant.</Alert>
          )}
        </>
      )}

      {bundle.direct.length > 0 && (
        <ul className="space-y-1.5">
          {bundle.direct.map((j) => (
            <li key={j.id}>
              <JustifLink filePath={j.file_path} filename={j.original_filename} />
            </li>
          ))}
        </ul>
      )}

      {bundle.viaRemboursement.map((rb) => (
        <div key={rb.remboursementId} className="rounded-md bg-brand-50/40 border border-brand-100 p-2.5 space-y-1.5">
          <Link
            href={`/remboursements/${rb.remboursementId}`}
            className="flex items-center gap-1.5 text-[12px] font-medium text-brand hover:underline underline-offset-2"
          >
            <span className="text-overline text-brand/80">Demande liée</span>
            <span className="font-mono">{rb.remboursementId}</span>
            {rb.demandeur && <span className="text-fg-muted font-normal">· {rb.demandeur}</span>}
            <ArrowRight size={11} strokeWidth={2.5} className="ml-auto" />
          </Link>
          {rb.justifs.length > 0 && (
            <ul className="space-y-1">
              {rb.justifs.map((j) => (
                <li key={j.id}>
                  <JustifLink filePath={j.file_path} filename={j.original_filename} />
                </li>
              ))}
            </ul>
          )}
          {rb.rib.map((j) => (
            <a
              key={j.id}
              href={`/api/justificatifs/${j.file_path}`}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-bg-elevated hover:text-brand transition-colors"
            >
              <CreditCard size={13} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
              <span className="truncate">RIB · {j.original_filename}</span>
            </a>
          ))}
        </div>
      ))}

      <form action={uploadJustificatif} className="pt-2 border-t border-border-soft">
        <input type="hidden" name="entity_type" value="ecriture" />
        <input type="hidden" name="entity_id" value={entityId} />
        <Field label="Ajouter un fichier">
          <input
            type="file"
            name="file"
            className="block w-full text-[13px] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand file:font-medium file:text-[13px] file:cursor-pointer hover:file:bg-brand-100 file:transition-colors"
          />
        </Field>
        <div className="flex justify-end mt-3">
          <PendingButton variant="outline" size="sm">
            Ajouter
          </PendingButton>
        </div>
      </form>

      {pendingDepots.length > 0 && (
        <form action={attachDepotFromEcriture} className="pt-2 border-t border-border-soft">
          <input type="hidden" name="ecriture_id" value={entityId} />
          <Field label="Rattacher un dépôt en attente" htmlFor={`depot-${entityId}`}>
            <NativeSelect
              id={`depot-${entityId}`}
              name="depot_id"
              required
              defaultValue=""
            >
              <option value="" disabled>
                — Choisir un dépôt —
              </option>
              <optgroup
                label={
                  suggestions.length > 0
                    ? `Suggestions (${suggestions.length})`
                    : 'Suggestions (aucune)'
                }
              >
                {suggestions.length === 0 && (
                  <option disabled>(rien ne matche dans la tolérance)</option>
                )}
                {suggestions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {depotLabel(d)}
                  </option>
                ))}
              </optgroup>
              {otherDepots.length > 0 && (
                <optgroup label={`Autres dépôts à traiter (${otherDepots.length})`}>
                  {otherDepots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {depotLabel(d)}
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
          </Field>
          <div className="flex justify-end mt-3">
            <PendingButton variant="outline" size="sm">
              Rattacher
            </PendingButton>
          </div>
        </form>
      )}
    </Section>
  );
}

function JustifLink({ filePath, filename }: { filePath: string; filename: string }) {
  return (
    <a
      href={`/api/justificatifs/${filePath}`}
      target="_blank"
      rel="noopener"
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
    >
      <Paperclip size={13} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
      <span className="truncate">{filename}</span>
    </a>
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
