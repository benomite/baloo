import { notFound } from 'next/navigation';
import { Landmark, Mail, Paperclip, Send } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentContext } from '@/lib/context';
import { getEcriture } from '@/lib/queries/ecritures';
import { listJustificatifs } from '@/lib/queries/justificatifs';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes } from '@/lib/queries/reference';
import { updateEcriture, updateEcritureStatus } from '@/lib/actions/ecritures';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
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
  const ecriture = await getEcriture(id);
  if (!ecriture) notFound();

  const sp = await searchParams;
  const ctx = await getCurrentContext();
  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const justificatifs = await listJustificatifs('ecriture', id);
  const updateAction = updateEcriture.bind(null, id);
  const noJustif = justificatifs.length === 0 && ecriture.justif_attendu !== 0;

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
                  <Button type="submit" variant="outline" size="sm">
                    Valider
                  </Button>
                </form>
                <SyncDraftButton ecritureId={id} />
              </>
            )}
            {ecriture.status === 'valide' && (
              <form action={updateEcritureStatus.bind(null, id, 'saisie_comptaweb')}>
                <Button type="submit" variant="outline" size="sm">
                  Marquer saisie Comptaweb
                </Button>
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
          categories={await listCategories()}
          unites={await listUnites()}
          modesPaiement={await listModesPaiement()}
          activites={await listActivites()}
          cartes={await listCartes()}
          ecriture={ecriture}
        />

        <aside className="lg:sticky lg:top-6 space-y-4">
          <JustificatifsCard
            entityId={id}
            justificatifs={justificatifs}
            justifAttendu={ecriture.justif_attendu === 1}
            numeroPiece={ecriture.numero_piece}
            type={ecriture.type}
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
  justificatifs,
  justifAttendu,
  numeroPiece,
  type,
}: {
  entityId: string;
  justificatifs: { id: string; file_path: string; original_filename: string }[];
  justifAttendu: boolean;
  numeroPiece: string | null;
  type: 'depense' | 'recette';
}) {
  return (
    <Section
      title={`Justificatifs (${justificatifs.length})`}
      subtitle={!justifAttendu ? 'Non requis pour cette écriture' : undefined}
    >
      {justificatifs.length === 0 && (
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

      {justificatifs.length > 0 && (
        <ul className="space-y-1.5">
          {justificatifs.map((j) => (
            <li key={j.id}>
              <a
                href={`/api/justificatifs/${j.file_path}`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
              >
                <Paperclip size={13} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
                <span className="truncate">{j.original_filename}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

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
          <Button type="submit" variant="outline" size="sm">
            Ajouter
          </Button>
        </div>
      </form>
    </Section>
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
          <Button type="submit" size="sm">
            <Mail size={14} strokeWidth={2} className="mr-1.5" />
            Envoyer la relance
          </Button>
        </div>
      </form>
    </Section>
  );
}
