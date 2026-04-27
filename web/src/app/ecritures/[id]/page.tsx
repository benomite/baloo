import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { getEcriture } from '@/lib/queries/ecritures';
import { listJustificatifs } from '@/lib/queries/justificatifs';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes } from '@/lib/queries/reference';
import { updateEcriture, updateEcritureStatus } from '@/lib/actions/ecritures';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
import { SyncDraftButton } from '@/components/ecritures/sync-draft-button';
import { formatAmount } from '@/lib/format';

export default async function EcritureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ecriture = getEcriture(id);
  if (!ecriture) notFound();

  const justificatifs = listJustificatifs('ecriture', id);
  const updateAction = updateEcriture.bind(null, id);

  return (
    <div>
      <PageHeader title={`${ecriture.id} — ${ecriture.description}`}>
        <EcritureStatusBadge status={ecriture.status} />
        <span className={`text-lg font-bold ${ecriture.type === 'depense' ? 'text-red-600' : 'text-green-600'}`}>
          {ecriture.type === 'depense' ? '-' : '+'}{formatAmount(ecriture.amount_cents)}
        </span>
      </PageHeader>

      {ecriture.ligne_bancaire_id && (
        <div className="mb-4 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          🏦 Issue de la ligne bancaire Comptaweb <code>{ecriture.ligne_bancaire_id}</code>
          {ecriture.ligne_bancaire_sous_index !== null && (
            <> sous-ligne <code>{ecriture.ligne_bancaire_sous_index}</code> (paiement carte multi-commerçants)</>
          )}
          {ecriture.comptaweb_ecriture_id && (
            <> · Synchronisée vers Comptaweb (id <code>{ecriture.comptaweb_ecriture_id}</code>)</>
          )}
        </div>
      )}

      {/* Status actions */}
      <div className="flex gap-2 mb-6">
        {ecriture.status === 'brouillon' && (
          <>
            <form action={updateEcritureStatus.bind(null, id, 'valide')}><Button variant="outline" size="sm">Valider</Button></form>
            <SyncDraftButton ecritureId={id} />
          </>
        )}
        {ecriture.status === 'valide' && (
          <form action={updateEcritureStatus.bind(null, id, 'saisie_comptaweb')}><Button variant="outline" size="sm">Marquer saisie Comptaweb</Button></form>
        )}
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-8">
        <div>
          <h2 className="text-lg font-semibold mb-4">Modifier</h2>
          <EcritureForm
            action={updateAction}
            categories={listCategories()}
            unites={listUnites()}
            modesPaiement={listModesPaiement()}
            activites={listActivites()}
            cartes={listCartes()}
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
        </div>
      </div>
    </div>
  );
}
