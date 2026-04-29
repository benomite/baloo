import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { RemboursementStatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { getRemboursement } from '@/lib/queries/remboursements';
import { listLignes } from '@/lib/services/remboursements';
import { listSignatures, verifyChain } from '@/lib/services/signatures';
import { listJustificatifs } from '@/lib/queries/justificatifs';
import { patchNotesAndRib } from '@/lib/actions/remboursements';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentContext } from '@/lib/context';
import { updateRemboursementStatus } from '@/lib/actions/remboursements';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
import { formatAmount } from '@/lib/format';

interface SearchParams {
  error?: string;
  edited?: string;
  patched?: string;
}

const STEPS = [
  { key: 'a_traiter', label: 'À traiter' },
  { key: 'valide_tresorier', label: 'Validé Trésorier' },
  { key: 'valide_rg', label: 'Validé RG' },
  { key: 'virement_effectue', label: 'Virement effectué' },
  { key: 'termine', label: 'Terminé' },
];

function stepIndex(status: string): number {
  if (status === 'refuse') return -1;
  const idx = STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

export default async function RemboursementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getCurrentContext();
  const r = await getRemboursement(id);
  if (!r) notFound();

  const [lignes, justificatifs, feuilles, ribFiles, signatures, chain] = await Promise.all([
    listLignes(id),
    listJustificatifs('remboursement', id),
    listJustificatifs('remboursement_feuille', id),
    listJustificatifs('remboursement_rib', id),
    listSignatures('remboursement', id),
    verifyChain('remboursement', id),
  ]);

  const currentIdx = stepIndex(r.status);
  const isAdmin = ctx.role === 'tresorier' || ctx.role === 'RG';
  const isTresorier = ctx.role === 'tresorier';
  const isRG = ctx.role === 'RG';

  const isOwner = !!r.submitted_by_user_id && r.submitted_by_user_id === ctx.userId;
  const canEditFull = (isOwner && r.status === 'a_traiter') || isAdmin;
  const patchAction = patchNotesAndRib.bind(null, id);

  return (
    <div>
      <PageHeader title={`${r.id} — ${r.demandeur}`}>
        <RemboursementStatusBadge status={r.status} />
        <span className="text-lg font-bold">{formatAmount(r.total_cents || r.amount_cents)}</span>
        {canEditFull && (
          <Link href={`/remboursements/${id}/edit`}>
            <Button variant="outline" size="sm">Modifier</Button>
          </Link>
        )}
      </PageHeader>

      {sp.error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {sp.error}
        </p>
      )}
      {sp.edited && (
        <p className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Modifications enregistrées. Le PDF feuille a été régénéré et la chaîne de signatures
          remise à jour.
        </p>
      )}
      {sp.patched && (
        <p className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Notes et RIB mis à jour.
        </p>
      )}

      {/* Timeline */}
      {r.status !== 'refuse' ? (
        <div className="flex items-center gap-2 mb-8 text-xs">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white font-bold ${i <= currentIdx ? 'bg-blue-600' : 'bg-gray-300'}`}>
                {i + 1}
              </div>
              <span className={i <= currentIdx ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
              {i < STEPS.length - 1 && (
                <span className={`w-6 h-0.5 ${i < currentIdx ? 'bg-blue-600' : 'bg-gray-300'}`} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-8 px-3 py-2 rounded bg-red-50 border border-red-200 text-sm text-red-800">
          🛑 Demande refusée{r.motif_refus ? ` — motif : ${r.motif_refus}` : ''}.
        </div>
      )}

      <div className="grid grid-cols-[1fr_300px] gap-8">
        <div>
          <Card className="mb-6">
            <CardHeader><CardTitle>Demandeur</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div><strong>Nom :</strong> {[r.prenom, r.nom].filter(Boolean).join(' ') || r.demandeur}</div>
              {r.email && <div><strong>Email :</strong> {r.email}</div>}
              <div><strong>Unité :</strong> {r.unite_code ?? '—'}</div>
              {r.notes && <div><strong>Notes :</strong> {r.notes}</div>}
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader><CardTitle>Détail des dépenses ({lignes.length})</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-4">Date</th>
                    <th className="py-1 pr-4">Nature</th>
                    <th className="py-1 pr-4 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="py-1 pr-4">{l.date_depense}</td>
                      <td className="py-1 pr-4">{l.nature}</td>
                      <td className="py-1 pr-4 text-right font-medium">{formatAmount(l.amount_cents)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-4"></td>
                    <td className="py-2 pr-4 font-semibold">Total</td>
                    <td className="py-2 pr-4 text-right font-bold">
                      {formatAmount(r.total_cents || r.amount_cents)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader><CardTitle>Coordonnées bancaires</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              {r.rib_texte ? (
                <div className="font-mono whitespace-pre-line">{r.rib_texte}</div>
              ) : ribFiles.length === 0 ? (
                <div className="text-muted-foreground italic">Aucune coordonnée bancaire fournie.</div>
              ) : null}
              {ribFiles.map((j) => (
                <div key={j.id} className="text-sm">
                  📄 <a href={`/api/justificatifs/${j.file_path}`} target="_blank" rel="noreferrer" className="text-blue-600 underline">RIB joint</a>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Édition limitée post-validation : notes + RIB texte (cf. ADR-022).
              Visible pour le demandeur et les admins une fois la demande validée. */}
          {(isOwner || isAdmin) && r.status !== 'a_traiter' && r.status !== 'refuse' && (
            <details className="mb-6 border rounded p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Modifier notes / RIB
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  (édition limitée — la demande est déjà validée)
                </span>
              </summary>
              <form action={patchAction} className="mt-3 space-y-3">
                <div>
                  <Label htmlFor="rib_texte" className="text-xs">IBAN / BIC (texte)</Label>
                  <Textarea
                    id="rib_texte"
                    name="rib_texte"
                    rows={2}
                    defaultValue={r.rib_texte ?? ''}
                    placeholder="FR76 ... · BIC ... · Banque ..."
                  />
                </div>
                <div>
                  <Label htmlFor="notes" className="text-xs">Notes</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    rows={2}
                    defaultValue={r.notes ?? ''}
                    placeholder="Précisions libres"
                  />
                </div>
                <Button type="submit" size="sm" variant="outline">Enregistrer</Button>
              </form>
            </details>
          )}

          {isAdmin && (
            <>
              <h3 className="font-semibold mb-3">Actions</h3>
              <div className="flex gap-2 flex-wrap mb-4">
                {r.status === 'a_traiter' && isTresorier && (
                  <form action={updateRemboursementStatus.bind(null, id, 'valide_tresorier')}>
                    <Button type="submit" size="sm">Valider (Trésorier)</Button>
                  </form>
                )}
                {r.status === 'valide_tresorier' && isRG && (
                  <form action={updateRemboursementStatus.bind(null, id, 'valide_rg')}>
                    <Button type="submit" size="sm">Valider (RG)</Button>
                  </form>
                )}
                {r.status === 'valide_rg' && (
                  <form action={updateRemboursementStatus.bind(null, id, 'virement_effectue')}>
                    <Button type="submit" size="sm">Virement effectué</Button>
                  </form>
                )}
                {r.status === 'virement_effectue' && (
                  <form action={updateRemboursementStatus.bind(null, id, 'termine')}>
                    <Button type="submit" size="sm">Marquer terminé</Button>
                  </form>
                )}
              </div>

              {/* Refus possible à toute étape sauf termine/refuse */}
              {!['termine', 'refuse'].includes(r.status) && (
                <details className="border rounded p-3 max-w-md">
                  <summary className="cursor-pointer text-sm font-medium text-red-600">Refuser la demande</summary>
                  <form action={updateRemboursementStatus.bind(null, id, 'refuse')} className="mt-3 space-y-2">
                    <Label htmlFor="motif" className="text-xs">Motif de refus</Label>
                    <Input id="motif" name="motif" required placeholder="Ex. justif manquant, hors scope" />
                    <Button type="submit" variant="destructive" size="sm">Refuser</Button>
                  </form>
                </details>
              )}
            </>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-3">Feuille de remboursement</h2>
            {feuilles.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">PDF non généré (demande créée avant le chantier 2-bis).</p>
            ) : (
              <div className="text-sm mb-2">
                📄 <a href={`/api/justificatifs/${feuilles[0].file_path}`} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                  {feuilles[0].original_filename}
                </a>
                {feuilles.length > 1 && (
                  <span className="text-xs text-muted-foreground ml-2">
                    ({feuilles.length} versions, dernière à {feuilles[0].uploaded_at.slice(11, 16)})
                  </span>
                )}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">
              Signatures ({signatures.length})
              {signatures.length > 0 && (
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${chain.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {chain.ok ? '✓ chaîne intègre' : '⚠ chaîne brisée'}
                </span>
              )}
            </h2>
            {signatures.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Aucune signature.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {signatures.map((s) => (
                  <li key={s.id} className="border rounded p-2 bg-card">
                    <div className="font-medium">
                      {s.signer_role === 'demandeur' ? '👤 Demandeur' : s.signer_role === 'tresorier' ? '💼 Trésorier' : s.signer_role === 'RG' ? '🛡️ RG' : s.signer_role}
                    </div>
                    <div className="text-xs">{s.signer_name ?? s.signer_email}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.server_timestamp.replace('T', ' ').replace('Z', ' UTC')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      IP {s.ip ?? '—'}
                    </div>
                    <details className="mt-1 text-[10px] text-muted-foreground">
                      <summary className="cursor-pointer">hashes</summary>
                      <div className="font-mono break-all mt-1">data : {s.data_hash}</div>
                      <div className="font-mono break-all">chain : {s.chain_hash}</div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Justificatifs ({justificatifs.length})</h2>
            {justificatifs.map(j => (
              <div key={j.id} className="flex items-center gap-2 mb-2 text-sm">
                <span>📎</span>
                <a href={`/api/justificatifs/${j.file_path}`} target="_blank" rel="noreferrer" className="hover:underline">{j.original_filename}</a>
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
    </div>
  );
}
