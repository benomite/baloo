import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Landmark } from 'lucide-react';

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
    <div>
      <PageHeader title={`${ecriture.id} — ${ecriture.description}`}>
        <EcritureStatusBadge status={ecriture.status} />
        <span className="text-lg font-bold">
          <Amount cents={ecriture.amount_cents} tone={ecriture.type === 'depense' ? 'negative' : 'positive'} />
        </span>
      </PageHeader>

      {ecriture.ligne_bancaire_id && (
        <Alert variant="info" icon={Landmark} className="mb-4">
          Issue de la ligne bancaire Comptaweb <code>{ecriture.ligne_bancaire_id}</code>
          {ecriture.ligne_bancaire_sous_index !== null && (
            <> sous-ligne <code>{ecriture.ligne_bancaire_sous_index}</code> (paiement carte multi-commerçants)</>
          )}
          {ecriture.comptaweb_ecriture_id && (
            <> · Synchronisée vers Comptaweb (id <code>{ecriture.comptaweb_ecriture_id}</code>)</>
          )}
        </Alert>
      )}

      {/* Status actions */}
      <div className="flex gap-2 mb-6">
        {ecriture.status === 'brouillon' && (
          <>
            <form action={updateEcritureStatus.bind(null, id, 'valide')}><Button type="submit" variant="outline" size="sm">Valider</Button></form>
            <SyncDraftButton ecritureId={id} />
          </>
        )}
        {ecriture.status === 'valide' && (
          <form action={updateEcritureStatus.bind(null, id, 'saisie_comptaweb')}><Button type="submit" variant="outline" size="sm">Marquer saisie Comptaweb</Button></form>
        )}
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-8">
        <div>
          <h2 className="text-lg font-semibold mb-4">Modifier</h2>
          <EcritureForm
            action={updateAction}
            categories={await listCategories()}
            unites={await listUnites()}
            modesPaiement={await listModesPaiement()}
            activites={await listActivites()}
            cartes={await listCartes()}
            ecriture={ecriture}
          />
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">Justificatifs ({justificatifs.length})</h2>

          {justificatifs.length === 0 && (
            ecriture.justif_attendu === 0 ? (
              <div className="text-sm rounded border border-muted bg-muted/40 px-3 py-2 mb-3">
                🚫 Justificatif non attendu (prélèvement auto / flux territoire).
              </div>
            ) : ecriture.numero_piece ? (
              <div className="text-sm rounded border border-amber-200 bg-amber-50 px-3 py-2 mb-3 text-amber-900">
                ⌛ En attente — code Comptaweb <code>{ecriture.numero_piece}</code> renseigné, document à rattacher.
              </div>
            ) : ecriture.type === 'depense' ? (
              <div className="text-sm rounded border border-orange-200 bg-orange-50 px-3 py-2 mb-3 text-orange-900">
                ⚠ Justificatif manquant.
              </div>
            ) : null
          )}

          {justificatifs.map(j => (
            <div key={j.id} className="flex items-center gap-2 mb-2 text-sm">
              <span>📎</span>
              <a href={`/api/justificatifs/${j.file_path}`} target="_blank" className="hover:underline">{j.original_filename}</a>
            </div>
          ))}

          <form action={uploadJustificatif} className="mt-4">
            <input type="hidden" name="entity_type" value="ecriture" />
            <input type="hidden" name="entity_id" value={id} />
            <input type="file" name="file" className="text-sm mb-2 block" />
            <Button type="submit" variant="outline" size="sm">Ajouter</Button>
          </form>

          {noJustif && isAdmin && (
            <div className="mt-6 border-t pt-4">
              {sp.relanced && (
                <p className="mb-3 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                  Relance envoyée à {sp.relanced}.
                </p>
              )}
              {sp.error && (
                <p className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                  {sp.error}
                </p>
              )}
              <details>
                <summary className="cursor-pointer text-sm font-medium">📨 Relancer pour le justif</summary>
                <form action={sendRelance} className="mt-3 space-y-2">
                  <input type="hidden" name="ecriture_id" value={id} />
                  <div>
                    <Label htmlFor="destinataire" className="text-xs">Destinataire (email)</Label>
                    <Input id="destinataire" name="destinataire" type="email" required placeholder="prenom@example.fr" />
                  </div>
                  <div>
                    <Label htmlFor="message" className="text-xs">Message (optionnel)</Label>
                    <Textarea id="message" name="message" rows={2} placeholder="Précision libre" />
                  </div>
                  <Button type="submit" size="sm">Envoyer la relance</Button>
                </form>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
