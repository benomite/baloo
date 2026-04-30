import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Briefcase,
  CheckCircle2,
  CreditCard,
  FileText,
  Paperclip,
  Shield,
  ShieldAlert,
  User,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { RemboursementStatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { PendingButton } from '@/components/shared/pending-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Amount } from '@/components/shared/amount';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { EcritureLinkCard } from '@/components/rembs/ecriture-link-card';
import { getRemboursement } from '@/lib/queries/remboursements';
import { listLignes } from '@/lib/services/remboursements';
import { listSignatures, verifyChain } from '@/lib/services/signatures';
import { listJustificatifs } from '@/lib/queries/justificatifs';
import {
  patchNotesAndRib,
  updateRemboursementStatus,
} from '@/lib/actions/remboursements';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
import { getCurrentContext } from '@/lib/context';
import { cn } from '@/lib/utils';

interface SearchParams {
  error?: string;
  edited?: string;
  patched?: string;
  linked?: string;
  unlinked?: string;
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

  const [sp, ctx, r, lignes, justificatifs, feuilles, ribFiles, signatures, chain] =
    await Promise.all([
      searchParams,
      getCurrentContext(),
      getRemboursement(id),
      listLignes(id),
      listJustificatifs('remboursement', id),
      listJustificatifs('remboursement_feuille', id),
      listJustificatifs('remboursement_rib', id),
      listSignatures('remboursement', id),
      verifyChain('remboursement', id),
    ]);
  if (!r) notFound();

  const currentIdx = stepIndex(r.status);
  const isAdmin = ctx.role === 'tresorier' || ctx.role === 'RG';
  const isTresorier = ctx.role === 'tresorier';
  const isRG = ctx.role === 'RG';

  const isOwner = !!r.submitted_by_user_id && r.submitted_by_user_id === ctx.userId;
  const canEditFull = (isOwner && r.status === 'a_traiter') || isAdmin;
  const canPatchNotes =
    (isOwner || isAdmin) && r.status !== 'a_traiter' && r.status !== 'refuse';
  const canRefuse = isAdmin && !['termine', 'refuse'].includes(r.status);
  const totalCents = r.total_cents || r.amount_cents;
  const patchAction = patchNotesAndRib.bind(null, id);

  const fullName = [r.prenom, r.nom].filter(Boolean).join(' ') || r.demandeur;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Remboursements', href: '/remboursements' }}
        title={r.id}
        subtitle={fullName}
        meta={
          <>
            <RemboursementStatusBadge status={r.status} />
            <Amount
              cents={totalCents}
              tone="negative"
              className="text-[22px] font-semibold tracking-tight"
            />
          </>
        }
        actions={
          canEditFull ? (
            <Link href={`/remboursements/${id}/edit`}>
              <Button variant="outline" size="sm">
                Modifier
              </Button>
            </Link>
          ) : null
        }
      />

      {sp.error && (
        <Alert variant="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.edited && (
        <Alert variant="success" className="mb-4">
          Modifications enregistrées. Le PDF feuille a été régénéré et la chaîne de signatures
          remise à jour.
        </Alert>
      )}
      {sp.patched && (
        <Alert variant="success" className="mb-4">
          Notes et RIB mis à jour.
        </Alert>
      )}
      {sp.linked && (
        <Alert variant="success" className="mb-4">
          Demande liée à l&apos;écriture{' '}
          <code className="font-mono text-[12.5px] font-medium">{sp.linked}</code>. Les
          justificatifs sont visibles depuis la fiche écriture.
        </Alert>
      )}
      {sp.unlinked && (
        <Alert variant="info" className="mb-4">
          Lien avec l&apos;écriture supprimé.
        </Alert>
      )}

      {r.status !== 'refuse' ? (
        <StatusTimeline currentIdx={currentIdx} />
      ) : (
        <Alert variant="error" icon={XCircle} className="mb-6">
          Demande refusée{r.motif_refus ? ` — motif : ${r.motif_refus}` : ''}.
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(280px,320px)] gap-6 items-start">
        <div className="space-y-6">
          <Section title="Demandeur">
            <dl className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-fg-muted">Nom</dt>
              <dd className="text-fg">{fullName}</dd>
              {r.email && (
                <>
                  <dt className="text-fg-muted">Email</dt>
                  <dd className="text-fg break-all">{r.email}</dd>
                </>
              )}
              <dt className="text-fg-muted">Unité</dt>
              <dd className="text-fg">{r.unite_code ?? '—'}</dd>
              {r.notes && (
                <>
                  <dt className="text-fg-muted">Notes</dt>
                  <dd className="text-fg whitespace-pre-line">{r.notes}</dd>
                </>
              )}
            </dl>
          </Section>

          <Section
            title={`Détail des dépenses (${lignes.length})`}
            action={
              <div className="text-right">
                <div className="text-overline text-fg-subtle">Total</div>
                <div className="text-display-sm tabular-nums text-fg">
                  <Amount cents={totalCents} tone="negative" />
                </div>
              </div>
            }
          >
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border-soft text-[11px] uppercase tracking-wide text-fg-subtle">
                    <th className="py-2 px-2 text-left font-medium">Date</th>
                    <th className="py-2 px-2 text-left font-medium">Nature</th>
                    <th className="py-2 px-2 text-right font-medium">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-border-soft last:border-b-0"
                    >
                      <td className="py-2 px-2 text-fg tabular-nums">{l.date_depense}</td>
                      <td className="py-2 px-2 text-fg">{l.nature}</td>
                      <td className="py-2 px-2 text-right font-medium">
                        <Amount cents={l.amount_cents} tone="negative" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title="Coordonnées bancaires"
            subtitle="Pour le virement."
          >
            {r.rib_texte ? (
              <div className="rounded-md border border-border-soft bg-bg-sunken/40 px-3 py-2.5 font-mono text-[12.5px] text-fg whitespace-pre-line">
                {r.rib_texte}
              </div>
            ) : ribFiles.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted italic">
                Aucune coordonnée bancaire fournie.
              </p>
            ) : null}
            {ribFiles.map((j) => (
              <a
                key={j.id}
                href={`/api/justificatifs/${j.file_path}`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
              >
                <CreditCard size={13} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
                <span className="truncate">RIB · {j.original_filename}</span>
              </a>
            ))}
          </Section>

          {canPatchNotes && (
            <Section
              title="Modifier notes / RIB"
              subtitle="Édition limitée — la demande est déjà validée."
            >
              <form action={patchAction} className="space-y-3">
                <Field label="IBAN / BIC (texte)" htmlFor="rib_texte_patch">
                  <Textarea
                    id="rib_texte_patch"
                    name="rib_texte"
                    rows={2}
                    defaultValue={r.rib_texte ?? ''}
                    placeholder="FR76 ... · BIC ... · Banque ..."
                  />
                </Field>
                <Field label="Notes" htmlFor="notes_patch">
                  <Textarea
                    id="notes_patch"
                    name="notes"
                    rows={2}
                    defaultValue={r.notes ?? ''}
                    placeholder="Précisions libres"
                  />
                </Field>
                <div className="flex justify-end">
                  <PendingButton variant="outline" size="sm">
                    Enregistrer
                  </PendingButton>
                </div>
              </form>
            </Section>
          )}

          {isAdmin && (
            <AdminActions
              id={id}
              status={r.status}
              isTresorier={isTresorier}
              isRG={isRG}
              canRefuse={canRefuse}
            />
          )}
        </div>

        <aside className="lg:sticky lg:top-6 space-y-4">
          {isAdmin && (
            <EcritureLinkCard
              rembsId={r.id}
              groupId={ctx.groupId}
              ecritureId={r.ecriture_id}
              amountCents={totalCents}
            />
          )}

          <Section
            title="Feuille de remboursement"
            subtitle={
              feuilles.length > 1
                ? `${feuilles.length} versions — dernière à ${feuilles[0].uploaded_at.slice(11, 16)}`
                : undefined
            }
          >
            {feuilles.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted italic">
                PDF non généré (demande créée avant le chantier 2-bis).
              </p>
            ) : (
              <a
                href={`/api/justificatifs/${feuilles[0].file_path}`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
              >
                <FileText size={13} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
                <span className="truncate">{feuilles[0].original_filename}</span>
              </a>
            )}
          </Section>

          <SignaturesCard signatures={signatures} chainOk={chain.ok} />

          <Section title={`Justificatifs (${justificatifs.length})`}>
            {justificatifs.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted italic">Aucun justificatif.</p>
            ) : (
              <ul className="space-y-1">
                {justificatifs.map((j) => (
                  <li key={j.id}>
                    <a
                      href={`/api/justificatifs/${j.file_path}`}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
                    >
                      <Paperclip
                        size={13}
                        className="shrink-0 text-fg-subtle"
                        strokeWidth={1.75}
                      />
                      <span className="truncate">{j.original_filename}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}

            <form action={uploadJustificatif} className="pt-2 border-t border-border-soft">
              <input type="hidden" name="entity_type" value="remboursement" />
              <input type="hidden" name="entity_id" value={id} />
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
          </Section>
        </aside>
      </div>
    </div>
  );
}

function StatusTimeline({ currentIdx }: { currentIdx: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-[12.5px]">
      {STEPS.map((s, i) => {
        const isActive = i <= currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold transition-colors',
                isActive ? 'bg-brand text-bg-elevated' : 'bg-bg-sunken text-fg-subtle',
                isCurrent && 'ring-2 ring-brand/25 ring-offset-2 ring-offset-bg',
              )}
            >
              {i + 1}
            </div>
            <span className={cn(isActive ? 'font-medium text-fg' : 'text-fg-muted')}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                className={cn(
                  'h-px w-5 sm:w-6',
                  i < currentIdx ? 'bg-brand' : 'bg-border-soft',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminActions({
  id,
  status,
  isTresorier,
  isRG,
  canRefuse,
}: {
  id: string;
  status: string;
  isTresorier: boolean;
  isRG: boolean;
  canRefuse: boolean;
}) {
  const hasNextAction =
    (status === 'a_traiter' && isTresorier) ||
    (status === 'valide_tresorier' && isRG) ||
    status === 'valide_rg' ||
    status === 'virement_effectue';

  if (!hasNextAction && !canRefuse) return null;

  return (
    <Section title="Actions" subtitle="Faire avancer la demande dans le workflow.">
      {hasNextAction && (
        <div className="flex flex-wrap gap-2">
          {status === 'a_traiter' && isTresorier && (
            <form action={updateRemboursementStatus.bind(null, id, 'valide_tresorier')}>
              <PendingButton size="sm" pendingLabel="Validation…">
                Valider (Trésorier)
              </PendingButton>
            </form>
          )}
          {status === 'valide_tresorier' && isRG && (
            <form action={updateRemboursementStatus.bind(null, id, 'valide_rg')}>
              <PendingButton size="sm" pendingLabel="Validation…">
                Valider (RG)
              </PendingButton>
            </form>
          )}
          {status === 'valide_rg' && (
            <form action={updateRemboursementStatus.bind(null, id, 'virement_effectue')}>
              <PendingButton size="sm">Virement effectué</PendingButton>
            </form>
          )}
          {status === 'virement_effectue' && (
            <form action={updateRemboursementStatus.bind(null, id, 'termine')}>
              <PendingButton size="sm">Marquer terminé</PendingButton>
            </form>
          )}
        </div>
      )}

      {canRefuse && (
        <details className="rounded-md border border-border-soft bg-bg-sunken/40 px-3 py-2.5 group">
          <summary className="cursor-pointer text-[13px] font-medium text-destructive list-none flex items-center gap-1.5">
            <XCircle size={13} strokeWidth={2} />
            Refuser la demande
          </summary>
          <form
            action={updateRemboursementStatus.bind(null, id, 'refuse')}
            className="mt-3 space-y-2"
          >
            <Field label="Motif de refus" htmlFor="motif" required>
              <Input
                id="motif"
                name="motif"
                required
                placeholder="Ex. justif manquant, hors scope"
              />
            </Field>
            <div className="flex justify-end">
              <PendingButton variant="destructive" size="sm">
                Refuser
              </PendingButton>
            </div>
          </form>
        </details>
      )}
    </Section>
  );
}

interface SignatureRow {
  id: number | string;
  signer_role: string;
  signer_name: string | null;
  signer_email: string;
  server_timestamp: string;
  ip: string | null;
  data_hash: string;
  chain_hash: string;
}

function SignaturesCard({
  signatures,
  chainOk,
}: {
  signatures: SignatureRow[];
  chainOk: boolean;
}) {
  return (
    <Section
      title={`Signatures (${signatures.length})`}
      subtitle={
        signatures.length > 0
          ? chainOk
            ? 'Chaîne intègre.'
            : 'Chaîne brisée — vérifier les hashes.'
          : undefined
      }
      action={
        signatures.length > 0 ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border',
              chainOk
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
                : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200',
            )}
          >
            {chainOk ? (
              <CheckCircle2 size={11} strokeWidth={2.25} />
            ) : (
              <ShieldAlert size={11} strokeWidth={2.25} />
            )}
            {chainOk ? 'OK' : 'KO'}
          </span>
        ) : undefined
      }
    >
      {signatures.length === 0 ? (
        <p className="text-[12.5px] text-fg-muted italic">Aucune signature.</p>
      ) : (
        <ul className="space-y-2">
          {signatures.map((s) => (
            <SignatureRowItem key={s.id} sig={s} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function SignatureRowItem({ sig }: { sig: SignatureRow }) {
  const Icon =
    sig.signer_role === 'demandeur'
      ? User
      : sig.signer_role === 'tresorier'
        ? Briefcase
        : sig.signer_role === 'RG'
          ? Shield
          : User;
  const roleLabel =
    sig.signer_role === 'demandeur'
      ? 'Demandeur'
      : sig.signer_role === 'tresorier'
        ? 'Trésorier'
        : sig.signer_role === 'RG'
          ? 'RG'
          : sig.signer_role;
  return (
    <li className="rounded-md border border-border-soft bg-bg-sunken/30 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Icon size={13} className="shrink-0 text-brand" strokeWidth={1.75} />
        <span className="text-[13px] font-medium text-fg">{roleLabel}</span>
      </div>
      <div className="mt-0.5 pl-[21px] text-[12px] text-fg-muted">
        {sig.signer_name ?? sig.signer_email}
      </div>
      <div className="pl-[21px] text-[11px] text-fg-subtle tabular-nums">
        {sig.server_timestamp.replace('T', ' ').replace('Z', ' UTC')}
        {sig.ip && ` · IP ${sig.ip}`}
      </div>
      <details className="mt-1 pl-[21px] text-[10px] text-fg-subtle">
        <summary className="cursor-pointer hover:text-fg-muted transition-colors">
          hashes
        </summary>
        <div className="font-mono break-all mt-1">data : {sig.data_hash}</div>
        <div className="font-mono break-all">chain : {sig.chain_hash}</div>
      </details>
    </li>
  );
}
