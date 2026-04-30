import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Mail,
  Paperclip,
  Send,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { AbandonStatusBadge } from '@/components/shared/status-badge';
import { Amount } from '@/components/shared/amount';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { Input } from '@/components/ui/input';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { getAbandon, type AbandonStatus } from '@/lib/services/abandons';
import { listJustificatifs } from '@/lib/queries/justificatifs';
import { getGroupe } from '@/lib/services/groupes';
import {
  markAbandonSentToNational,
  refuseAbandon,
  setCerfaEmis,
  validateAbandon,
} from '@/lib/actions/abandons';
import { buildNationalMailto, SGDF_DONATEURS_EMAIL } from '@/lib/email/abandon';
import { cn } from '@/lib/utils';

interface SearchParams {
  error?: string;
  updated?: string;
}

const STEPS: { key: AbandonStatus; label: string }[] = [
  { key: 'a_traiter', label: 'À traiter' },
  { key: 'valide', label: 'Validé' },
  { key: 'envoye_national', label: 'Envoyé au national' },
];

function stepIndex(status: AbandonStatus): number {
  if (status === 'refuse') return -1;
  return STEPS.findIndex((s) => s.key === status);
}

export default async function AbandonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getCurrentContext();

  const a = await getAbandon({ groupId: ctx.groupId }, id);
  if (!a) notFound();

  const isAdmin = ctx.role === 'tresorier' || ctx.role === 'RG';
  const isOwner = !!a.submitted_by_user_id && a.submitted_by_user_id === ctx.userId;
  if (!isAdmin && !isOwner) notFound();

  const [feuilles, justifs, groupe] = await Promise.all([
    listJustificatifs('abandon_feuille', id),
    listJustificatifs('abandon', id),
    getGroupe({ groupId: ctx.groupId }),
  ]);

  const currentIdx = stepIndex(a.status);
  const fullName =
    [a.prenom, a.nom].filter(Boolean).join(' ') || a.donateur;

  const mailtoHref =
    a.status === 'valide' || a.status === 'envoye_national'
      ? buildNationalMailto({
          abandonId: a.id,
          donateur: fullName,
          natureDescription: a.nature,
          amountCents: a.amount_cents,
          dateDepense: a.date_depense,
          anneeFiscale: a.annee_fiscale,
          groupName: groupe?.nom ?? null,
        })
      : null;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Abandons', href: '/abandons' }}
        title={a.id}
        subtitle={fullName}
        meta={
          <>
            <AbandonStatusBadge status={a.status} />
            <Amount
              cents={a.amount_cents}
              tone="negative"
              className="text-[22px] font-semibold tracking-tight"
            />
            {a.cerfa_emis === 1 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                <CheckCircle2 size={11} strokeWidth={2.25} />
                CERFA émis
              </span>
            )}
          </>
        }
      />

      {sp.error && (
        <Alert variant="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.updated && (
        <Alert variant="success" className="mb-4">
          Mise à jour enregistrée.
        </Alert>
      )}

      {a.status !== 'refuse' ? (
        <StatusTimeline currentIdx={currentIdx} />
      ) : (
        <Alert variant="error" icon={XCircle} className="mb-6">
          Demande refusée{a.motif_refus ? ` — motif : ${a.motif_refus}` : ''}.
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(280px,320px)] gap-6 items-start">
        <div className="space-y-6">
          <Section title="Donateur">
            <dl className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-fg-muted">Nom</dt>
              <dd className="text-fg">{fullName}</dd>
              {a.email && (
                <>
                  <dt className="text-fg-muted">Email</dt>
                  <dd className="text-fg break-all">{a.email}</dd>
                </>
              )}
              <dt className="text-fg-muted">Année fiscale</dt>
              <dd className="text-fg tabular-nums">{a.annee_fiscale}</dd>
              <dt className="text-fg-muted">Unité</dt>
              <dd className="text-fg">{a.unite_code ?? '—'}</dd>
            </dl>
          </Section>

          <Section title="La dépense">
            <dl className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-fg-muted">Date</dt>
              <dd className="text-fg tabular-nums">{a.date_depense}</dd>
              <dt className="text-fg-muted">Nature</dt>
              <dd className="text-fg">{a.nature}</dd>
              <dt className="text-fg-muted">Montant</dt>
              <dd className="text-fg font-medium">
                <Amount cents={a.amount_cents} />
              </dd>
              {a.notes && (
                <>
                  <dt className="text-fg-muted">Notes</dt>
                  <dd className="text-fg whitespace-pre-line">{a.notes}</dd>
                </>
              )}
            </dl>
          </Section>

          {isAdmin && (
            <AdminActions
              id={id}
              status={a.status}
              cerfaEmis={a.cerfa_emis === 1}
              mailtoHref={mailtoHref}
              sentAt={a.sent_to_national_at}
              cerfaAt={a.cerfa_emis_at}
            />
          )}
        </div>

        <aside className="lg:sticky lg:top-6 space-y-4">
          <Section
            title={`Feuille d'abandon (${feuilles.length})`}
            subtitle={
              feuilles.length === 0
                ? 'À envoyer au national signée.'
                : 'Document à transmettre au national.'
            }
          >
            {feuilles.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted italic">
                Aucune feuille attachée.
              </p>
            ) : (
              <ul className="space-y-1">
                {feuilles.map((f) => (
                  <li key={f.id}>
                    <a
                      href={`/api/justificatifs/${f.file_path}`}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
                    >
                      <FileSpreadsheet
                        size={13}
                        className="shrink-0 text-fg-subtle"
                        strokeWidth={1.75}
                      />
                      <span className="truncate">{f.original_filename}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Justificatifs (${justifs.length})`}>
            {justifs.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted italic">Aucun justificatif.</p>
            ) : (
              <ul className="space-y-1">
                {justifs.map((j) => (
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
  cerfaEmis,
  mailtoHref,
  sentAt,
  cerfaAt,
}: {
  id: string;
  status: AbandonStatus;
  cerfaEmis: boolean;
  mailtoHref: string | null;
  sentAt: string | null;
  cerfaAt: string | null;
}) {
  const canValidate = status === 'a_traiter';
  const canMarkSent = status === 'valide';
  const canRefuse = status === 'a_traiter' || status === 'valide';
  const canToggleCerfa = status === 'envoye_national';

  return (
    <Section title="Actions" subtitle="Faire avancer l'abandon dans le workflow.">
      {canValidate && (
        <form action={validateAbandon.bind(null, id)}>
          <PendingButton size="sm" pendingLabel="Validation…">
            Valider la demande
          </PendingButton>
        </form>
      )}

      {canMarkSent && mailtoHref && (
        <div className="space-y-3 rounded-md border border-border-soft bg-bg-sunken/40 p-3">
          <div className="flex items-start gap-2 text-[12.5px] text-fg-muted">
            <Mail size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-brand" />
            <p>
              Envoie la feuille signée à{' '}
              <code className="font-mono text-[12px] font-medium">
                {SGDF_DONATEURS_EMAIL}
              </code>{' '}
              en pièce jointe — le mail s&apos;ouvre pré-rempli.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={mailtoHref}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-brand-50 hover:text-brand hover:border-brand-100 transition-colors"
            >
              <Mail size={13} strokeWidth={2} />
              Ouvrir le mail
            </a>
            <form action={markAbandonSentToNational.bind(null, id)}>
              <PendingButton size="sm" pendingLabel="Enregistrement…">
                <Send size={13} strokeWidth={2} className="mr-1.5" />
                Marquer envoyé
              </PendingButton>
            </form>
          </div>
        </div>
      )}

      {status === 'envoye_national' && sentAt && (
        <p className="text-[12px] text-fg-muted">
          Envoyé au national le{' '}
          <span className="font-medium text-fg tabular-nums">
            {sentAt.slice(0, 10)}
          </span>
          .
        </p>
      )}

      {canToggleCerfa && (
        <form action={setCerfaEmis.bind(null, id, !cerfaEmis)}>
          <PendingButton variant={cerfaEmis ? 'outline' : 'default'} size="sm">
            {cerfaEmis ? (
              <>
                <CheckCircle2 size={13} strokeWidth={2.25} className="mr-1.5" />
                CERFA émis — annuler
              </>
            ) : (
              <>
                <Circle size={13} strokeWidth={2} className="mr-1.5" />
                Marquer CERFA reçu
              </>
            )}
          </PendingButton>
        </form>
      )}

      {cerfaEmis && cerfaAt && (
        <p className="text-[12px] text-fg-muted">
          CERFA émis le{' '}
          <span className="font-medium text-fg tabular-nums">{cerfaAt.slice(0, 10)}</span>.
        </p>
      )}

      {canRefuse && (
        <details className="rounded-md border border-border-soft bg-bg-sunken/40 px-3 py-2.5 group">
          <summary className="cursor-pointer text-[13px] font-medium text-destructive list-none flex items-center gap-1.5">
            <AlertCircle size={13} strokeWidth={2} />
            Refuser la demande
          </summary>
          <form
            action={refuseAbandon.bind(null, id)}
            className="mt-3 space-y-2"
          >
            <Field label="Motif de refus" htmlFor="motif" required>
              <Input
                id="motif"
                name="motif"
                required
                placeholder="Ex. justif manquant, hors scope, doublon"
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
