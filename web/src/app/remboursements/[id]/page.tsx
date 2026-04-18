import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { RemboursementStatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getRemboursement } from '@/lib/queries/remboursements';
import { listJustificatifs } from '@/lib/queries/justificatifs';
import { updateRemboursementStatus } from '@/lib/actions/remboursements';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
import { formatAmount } from '@/lib/format';

export default async function RemboursementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getRemboursement(id);
  if (!r) notFound();

  const justificatifs = listJustificatifs('remboursement', id);

  return (
    <div>
      <PageHeader title={`${r.id} — ${r.demandeur}`}>
        <RemboursementStatusBadge status={r.status} />
        <span className="text-lg font-bold">{formatAmount(r.amount_cents)}</span>
      </PageHeader>

      <div className="grid grid-cols-[1fr_300px] gap-8">
        <div>
          <Card className="mb-6">
            <CardHeader><CardTitle>Détails</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><strong>Demandeur :</strong> {r.demandeur}</div>
              <div><strong>Date dépense :</strong> {r.date_depense}</div>
              <div><strong>Nature :</strong> {r.nature}</div>
              <div><strong>Montant :</strong> {formatAmount(r.amount_cents)}</div>
              <div><strong>Unité :</strong> {r.unite_code ?? '—'}</div>
              <div><strong>Mode paiement :</strong> {r.mode_paiement_name ?? '—'}</div>
              <div><strong>Date paiement :</strong> {r.date_paiement ?? '—'}</div>
              <div><strong>Comptaweb :</strong> {r.comptaweb_synced ? 'Saisi' : 'Non saisi'}</div>
              {r.notes && <div><strong>Notes :</strong> {r.notes}</div>}
            </CardContent>
          </Card>

          <h3 className="font-semibold mb-3">Actions</h3>
          <div className="flex gap-2">
            {r.status === 'demande' && (
              <>
                <form action={updateRemboursementStatus.bind(null, id, 'valide')}><Button size="sm">Valider</Button></form>
                <form action={updateRemboursementStatus.bind(null, id, 'refuse')}><Button variant="destructive" size="sm">Refuser</Button></form>
              </>
            )}
            {r.status === 'valide' && (
              <form action={updateRemboursementStatus.bind(null, id, 'paye')}><Button size="sm">Marquer payé</Button></form>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">Justificatifs ({justificatifs.length})</h2>
          {justificatifs.map(j => (
            <div key={j.id} className="flex items-center gap-2 mb-2 text-sm">
              <span>📎</span>
              <a href={`/api/justificatifs/${j.file_path}`} target="_blank" className="hover:underline">{j.original_filename}</a>
            </div>
          ))}

          <form action={uploadJustificatif} className="mt-4">
            <input type="hidden" name="entity_type" value="remboursement" />
            <input type="hidden" name="entity_id" value={id} />
            <input type="file" name="file" className="text-sm mb-2 block" />
            <Button type="submit" variant="outline" size="sm">Ajouter</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
