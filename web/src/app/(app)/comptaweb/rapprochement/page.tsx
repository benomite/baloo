import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  Landmark,
  RefreshCw,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/shared/section';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/shared/empty-state';
import { Amount } from '@/components/shared/amount';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { withAutoReLogin } from '@/lib/comptaweb/auth';
import { listRapprochementBancaire } from '@/lib/comptaweb/ecritures-bancaires';
import type {
  EcritureBancaireNonRapprochee,
  EcritureComptableNonRapprochee,
  RapprochementBancaireData,
} from '@/lib/comptaweb/types';
import { logError } from '@/lib/log';

// Page de visualisation du rapprochement bancaire DSP2 lu depuis
// Comptaweb. Lecture seule au MVP — pour faire le rapprochement
// effectif, le trésorier reste sur Comptaweb (mais voit ici en un
// coup d'œil ce qui reste à pointer + les sous-lignes DSP2 qui
// ventilent les paiements multi-commerçants des cartes procurement).

// Force le rendu dynamique (sinon Next essaie de précompiler la page,
// fait un appel comptaweb au build et ça plante).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function RapprochementPage() {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  let data: RapprochementBancaireData | null = null;
  let fetchError: string | null = null;

  try {
    data = await withAutoReLogin((config) => listRapprochementBancaire(config));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fetchError = message;
    logError('comptaweb', 'Lecture rapprochement échouée', err);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Rapprochement bancaire"
        subtitle={
          data
            ? `Compte ${data.libelleCompte} — lecture directe depuis Comptaweb (lecture seule).`
            : 'Lecture des écritures bancaires non rapprochées depuis Comptaweb.'
        }
      />

      {fetchError && (
        <Alert variant="error" icon={AlertTriangle} className="mb-6">
          <div>
            Impossible de lire le rapprochement depuis Comptaweb :{' '}
            <code className="font-mono text-[12px]">{fetchError}</code>
          </div>
          <div className="mt-2 text-[12.5px]">
            Vérifie que <code className="font-mono text-[12px]">COMPTAWEB_USERNAME</code> et{' '}
            <code className="font-mono text-[12px]">COMPTAWEB_PASSWORD</code> sont définis dans
            l&apos;environnement Vercel. Le scan peut aussi échouer en cold start (filesystem
            <code className="font-mono text-[12px]"> /var/task</code> en lecture seule, le
            cache de session est dans <code className="font-mono text-[12px]">/tmp</code> et
            disparaît à chaque cold start — un retry suffit en général).
          </div>
        </Alert>
      )}

      {data && (
        <>
          <Alert variant="info" icon={RefreshCw} className="mb-6">
            <div>
              <strong>{data.ecrituresBancaires.length}</strong> ligne{data.ecrituresBancaires.length > 1 ? 's' : ''}{' '}
              bancaire{data.ecrituresBancaires.length > 1 ? 's' : ''} non rapprochée
              {data.ecrituresBancaires.length > 1 ? 's' : ''} ·{' '}
              <strong>{data.ecrituresComptables.length}</strong> écriture
              {data.ecrituresComptables.length > 1 ? 's' : ''} comptable
              {data.ecrituresComptables.length > 1 ? 's' : ''} non rapprochée
              {data.ecrituresComptables.length > 1 ? 's' : ''}.
            </div>
            <div className="mt-1 text-[12px]">
              Pour faire le rapprochement effectif, va sur Comptaweb. Cette vue est en lecture
              seule — utile pour mesurer la dette de pointage en un coup d&apos;œil.
            </div>
          </Alert>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <BankSideSection ecritures={data.ecrituresBancaires} />
            <BookSideSection ecritures={data.ecrituresComptables} />
          </div>
        </>
      )}
    </div>
  );
}

function BankSideSection({ ecritures }: { ecritures: EcritureBancaireNonRapprochee[] }) {
  const total = ecritures.reduce((sum, e) => sum + e.montantCentimes, 0);
  return (
    <Section
      title={`Côté banque (${ecritures.length})`}
      subtitle="Lignes apparaissant sur le relevé sans écriture comptable associée."
      action={
        ecritures.length > 0 ? (
          <span className="text-[12.5px] text-fg-muted">
            net{' '}
            <span className="font-medium tabular-nums text-fg">
              <Amount cents={total} tone="signed" />
            </span>
          </span>
        ) : undefined
      }
      bodyClassName={ecritures.length === 0 ? undefined : 'px-0 pb-0'}
    >
      {ecritures.length === 0 ? (
        <EmptyState
          emoji="✓"
          title="Tout est pointé côté banque"
          description="Toutes les lignes du relevé bancaire ont une écriture comptable associée."
        />
      ) : (
        <ul className="divide-y divide-border-soft">
          {ecritures.map((e) => (
            <li key={e.id} className="px-6 py-3">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand mt-0.5">
                  <Landmark size={14} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-fg">{e.intitule}</div>
                  <div className="text-[12px] text-fg-muted tabular-nums">
                    {e.dateOperation}
                    <span className="mx-1.5 text-fg-subtle">·</span>
                    <code className="font-mono text-[11.5px]">#{e.id}</code>
                  </div>
                  {e.sousLignes.length > 0 && (
                    <details className="mt-2 rounded-md border border-border-soft bg-bg-sunken/30 px-2.5 py-1.5">
                      <summary className="cursor-pointer text-[11.5px] font-medium text-fg-muted hover:text-fg list-none">
                        DSP2 — {e.sousLignes.length} sous-ligne{e.sousLignes.length > 1 ? 's' : ''}
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {e.sousLignes.map((s, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
                            <span className="text-fg-muted truncate">{s.commercant}</span>
                            <span className="font-medium tabular-nums text-fg shrink-0">
                              <Amount cents={s.montantCentimes} tone="signed" />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-medium tabular-nums text-fg">
                    {e.montantCentimes >= 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <ArrowUpCircle size={11} strokeWidth={2.25} />
                        <Amount cents={e.montantCentimes} />
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-fg">
                        <ArrowDownCircle size={11} strokeWidth={2.25} className="text-destructive" />
                        <Amount cents={Math.abs(e.montantCentimes)} tone="negative" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function BookSideSection({ ecritures }: { ecritures: EcritureComptableNonRapprochee[] }) {
  const total = ecritures.reduce((sum, e) => sum + e.montantCentimes, 0);
  return (
    <Section
      title={`Côté compta (${ecritures.length})`}
      subtitle="Écritures saisies dans Comptaweb sans ligne bancaire associée."
      action={
        ecritures.length > 0 ? (
          <span className="text-[12.5px] text-fg-muted">
            net{' '}
            <span className="font-medium tabular-nums text-fg">
              <Amount cents={total} tone="signed" />
            </span>
          </span>
        ) : undefined
      }
      bodyClassName={ecritures.length === 0 ? undefined : 'px-0 pb-0'}
    >
      {ecritures.length === 0 ? (
        <EmptyState
          emoji="✓"
          title="Tout est pointé côté compta"
          description="Toutes les écritures comptables ont une ligne bancaire associée."
        />
      ) : (
        <ul className="divide-y divide-border-soft">
          {ecritures.map((e) => (
            <li key={e.id} className="px-6 py-3">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand mt-0.5">
                  <Building2 size={14} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-fg">{e.intitule}</div>
                  <div className="text-[12px] text-fg-muted">
                    <span className="tabular-nums">{e.dateEcriture}</span>
                    <span className="mx-1.5 text-fg-subtle">·</span>
                    <code className="font-mono text-[11.5px]">#{e.id}</code>
                    <span className="mx-1.5 text-fg-subtle">·</span>
                    <span>{e.type}</span>
                    {e.numeroPiece && (
                      <>
                        <span className="mx-1.5 text-fg-subtle">·</span>
                        <code className="font-mono text-[11.5px]">{e.numeroPiece}</code>
                      </>
                    )}
                  </div>
                  {e.tiers && (
                    <div className="text-[11.5px] text-fg-subtle mt-0.5">{e.tiers}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-medium tabular-nums text-fg">
                    {e.montantCentimes >= 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <ArrowUpCircle size={11} strokeWidth={2.25} />
                        <Amount cents={e.montantCentimes} />
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-fg">
                        <ArrowDownCircle size={11} strokeWidth={2.25} className="text-destructive" />
                        <Amount cents={Math.abs(e.montantCentimes)} tone="negative" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
