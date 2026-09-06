import Link from 'next/link';
import { Section } from '@/components/shared/section';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { Alert } from '@/components/ui/alert';
import type { CampBilan, DepotOrphelin } from '@/lib/services/camp-bilan';
import type { BilanEcriture } from '@/lib/services/camp-bilan-logic';

// Onglet « Bilan » d'un camp : le récapitulatif de fin — résultat, ce qui
// reste à finir (pièces manquantes, tickets rattachés à rien), budget vs
// réalisé, et la liste exhaustive des écritures.

export function CampBilanPanel({ bilan }: { bilan: CampBilan }) {
  const {
    camp, resultat, ecritures, justifs, depotsOrphelins,
    depotsSansImputationCount, sansUniteCount, avancesEnCirculation, rows,
  } = bilan;

  const enAttente = depotsOrphelins.filter((d) => d.statut === 'a_traiter');
  const rejetes = depotsOrphelins.filter((d) => d.statut === 'rejete');
  const aFinir =
    justifs.manquants.length + enAttente.length + avancesEnCirculation.length +
    sansUniteCount + depotsSansImputationCount;

  return (
    <div className="space-y-6">
      <Section
        title="Résultat du camp"
        subtitle={
          camp.statut === 'cloture'
            ? 'Camp clôturé — photo de fin.'
            : 'Camp non clôturé : les chiffres bougeront encore.'
        }
      >
        <div className="grid grid-cols-3 gap-4 text-center">
          <Chiffre label="Recettes" cents={resultat.recettesCents} tone="positive" />
          <Chiffre label="Dépenses" cents={resultat.depensesCents} tone="negative" />
          <Chiffre label="Résultat" cents={resultat.resultatCents} tone="signed" big />
        </div>

        {resultat.depotsEnAttenteCents > 0 && (
          <p className="pt-3 border-t border-border-soft text-[12.5px] text-fg-muted">
            <Amount cents={resultat.depotsEnAttenteCents} /> de tickets déposés ne sont
            pas encore rapprochés d&apos;une écriture. Une fois passés en banque, le
            résultat serait de{' '}
            <span className="font-medium">
              <Amount cents={resultat.resultatProjeteCents} tone="signed" />
            </span>
            .
          </p>
        )}
      </Section>

      <Section
        title="Ce qui reste à finir"
        subtitle={aFinir === 0 ? undefined : `${aFinir} point${aFinir > 1 ? 's' : ''} à traiter avant de clôturer.`}
      >
        {aFinir === 0 ? (
          <EmptyState
            emoji="✅"
            title="Rien à finir"
            description="Toutes les pièces sont là, aucun ticket en suspens, aucune avance en circulation."
            className="py-6"
          />
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {justifs.manquants.length > 0 && (
              <Point n={justifs.manquants.length} label="dépense(s) sans justificatif" ancre="#bilan-justifs" />
            )}
            {enAttente.length > 0 && (
              <Point n={enAttente.length} label="ticket(s) déposé(s) rattaché(s) à aucune écriture" ancre="#bilan-depots" />
            )}
            {avancesEnCirculation.length > 0 && (
              <Point
                n={avancesEnCirculation.length}
                label="avance(s) de trésorerie encore en circulation (à clôturer dans l'onglet Dépenses)"
              />
            )}
            {sansUniteCount > 0 && (
              <Point
                n={sansUniteCount}
                label="écriture(s) de l'activité sans branche/pôle — invisibles de ce bilan"
                href="/ecritures?sans_unite=1"
              />
            )}
            {depotsSansImputationCount > 0 && (
              <Point
                n={depotsSansImputationCount}
                label="dépôt(s) en attente du groupe sans activité ou sans branche/pôle — n'apparaissent dans aucun camp"
                href="/depots"
              />
            )}
          </ul>
        )}
      </Section>

      <Section
        title="Justificatifs"
        subtitle="Toutes les dépenses du camp qui n'ont pas de pièce attachée."
        className="scroll-mt-4"
      >
        <div id="bilan-justifs" className="space-y-5">
          <BlocJustif
            titre="Manquants"
            aide="Pièce attendue, rien d'attaché, pas de remboursement : à récupérer."
            ton="warning"
            ecritures={justifs.manquants}
          />
          <BlocJustif
            titre="Couverts par un remboursement"
            aide="La pièce vit sur la demande de remboursement, pas sur l'écriture."
            ecritures={justifs.couvertsParRemboursement}
          />
          <BlocJustif
            titre="Justificatif non attendu"
            aide="Marquées comme n'ayant pas besoin de pièce."
            ecritures={justifs.nonAttendus}
          />
          {justifs.manquants.length === 0 &&
            justifs.couvertsParRemboursement.length === 0 &&
            justifs.nonAttendus.length === 0 && (
              <p className="text-[13px] text-fg-muted">
                Toutes les dépenses du camp ont leur justificatif.
              </p>
            )}
        </div>
      </Section>

      <Section
        title="Dépôts liés à rien"
        subtitle="Tickets déposés qui n'ont jamais été rattachés à une écriture."
      >
        <div id="bilan-depots" className="space-y-5">
          {depotsOrphelins.length === 0 ? (
            <p className="text-[13px] text-fg-muted">
              Tous les tickets déposés sur ce camp ont été rattachés.
            </p>
          ) : (
            <>
              <BlocDepots titre="En attente de rattachement" depots={enAttente} />
              <BlocDepots titre="Rejetés" depots={rejetes} />
            </>
          )}
          {depotsSansImputationCount > 0 && (
            <Alert variant="warning">
              {depotsSansImputationCount} dépôt{depotsSansImputationCount > 1 ? 's' : ''} en
              attente dans le groupe sans activité ou sans branche/pôle :{' '}
              {depotsSansImputationCount > 1 ? 'ils n’apparaissent' : 'il n’apparaît'} dans
              aucun camp.{' '}
              <Link href="/depots" className="underline underline-offset-2 font-medium">
                Voir les dépôts
              </Link>
            </Alert>
          )}
        </div>
      </Section>

      <Section title="Budget vs réalisé" subtitle="Par poste de dépense.">
        {rows.postes.length === 0 ? (
          <p className="text-[13px] text-fg-muted">Aucun budget ni dépense sur ce camp.</p>
        ) : (
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-fg-muted text-[11.5px] uppercase tracking-wide">
                  <th className="text-left font-medium pb-2">Poste</th>
                  <th className="text-right font-medium pb-2">Budget</th>
                  <th className="text-right font-medium pb-2">Réalisé</th>
                  <th className="text-right font-medium pb-2">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {rows.postes.map((p) => (
                  <tr key={p.categoryId ?? '__none__'}>
                    <td className="py-2 pr-3 text-fg">{p.categoryName}</td>
                    <td className="py-2 text-right tabular-nums">
                      <Amount cents={p.budgetCents} tone="muted" />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <Amount cents={p.depenseCents} />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <Amount cents={p.budgetCents - p.depenseCents} tone="signed" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t border-border">
                  <td className="pt-2.5 pr-3 text-fg">Total</td>
                  <td className="pt-2.5 text-right tabular-nums">
                    <Amount cents={rows.totalBudgetDepensesCents} tone="muted" />
                  </td>
                  <td className="pt-2.5 text-right tabular-nums">
                    <Amount cents={rows.totalDepenseCents} />
                  </td>
                  <td className="pt-2.5 text-right tabular-nums">
                    <Amount
                      cents={rows.totalBudgetDepensesCents - rows.totalDepenseCents}
                      tone="signed"
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Toutes les écritures"
        subtitle={`${ecritures.length} écriture${ecritures.length > 1 ? 's' : ''} imputée${ecritures.length > 1 ? 's' : ''} à ce camp.`}
      >
        {ecritures.length === 0 ? (
          <EmptyState
            title="Aucune écriture"
            description="Rien n'est encore imputé à ce camp."
            className="py-6"
          />
        ) : (
          <ul className="divide-y divide-border-soft rounded-lg border border-border-soft overflow-hidden">
            {ecritures.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/ecritures/${e.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 text-[13px] transition-colors hover:bg-bg-sunken/40"
                >
                  <PastilleJustif ecriture={e} />
                  <span className="tabular-nums text-fg-subtle shrink-0">{e.date_ecriture}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">
                    {e.description}
                    {e.category_name && (
                      <span className="text-fg-subtle"> · {e.category_name}</span>
                    )}
                  </span>
                  <span className="tabular-nums shrink-0">
                    <Amount
                      cents={e.amount_cents}
                      tone={e.type === 'recette' ? 'positive' : 'negative'}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Chiffre({
  label,
  cents,
  tone,
  big,
}: {
  label: string;
  cents: number;
  tone: 'positive' | 'negative' | 'signed';
  big?: boolean;
}) {
  return (
    <div>
      <p className="text-[11.5px] uppercase tracking-wide text-fg-muted">{label}</p>
      <p className={`mt-1 tabular-nums ${big ? 'text-[22px] font-semibold' : 'text-[16px] font-medium'}`}>
        <Amount cents={cents} tone={tone} />
      </p>
    </div>
  );
}

function Point({
  n,
  label,
  href,
  ancre,
}: {
  n: number;
  label: string;
  href?: string;
  ancre?: string;
}) {
  const contenu = (
    <>
      <span className="font-medium text-fg">{n}</span> {label}
    </>
  );
  return (
    <li className="flex items-baseline gap-2">
      <span className="size-1.5 rounded-full bg-amber-500 shrink-0 translate-y-[-2px]" aria-hidden />
      {href || ancre ? (
        <Link href={href ?? ancre!} className="text-fg-muted hover:text-fg underline-offset-2 hover:underline">
          {contenu}
        </Link>
      ) : (
        <span className="text-fg-muted">{contenu}</span>
      )}
    </li>
  );
}

function BlocJustif({
  titre,
  aide,
  ton,
  ecritures,
}: {
  titre: string;
  aide: string;
  ton?: 'warning';
  ecritures: BilanEcriture[];
}) {
  if (ecritures.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <h3 className="text-[13.5px] font-medium text-fg">
          {titre}{' '}
          <span
            className={`ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
              ton === 'warning'
                ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                : 'bg-bg-sunken text-fg-muted'
            }`}
          >
            {ecritures.length}
          </span>
        </h3>
        <span className="tabular-nums text-[12.5px] text-fg-muted shrink-0">
          <Amount cents={ecritures.reduce((s, e) => s + e.amount_cents, 0)} tone="muted" />
        </span>
      </div>
      <p className="mb-2 text-[12px] text-fg-subtle">{aide}</p>
      <ul className="divide-y divide-border-soft rounded-lg border border-border-soft overflow-hidden">
        {ecritures.map((e) => (
          <li key={e.id}>
            <Link
              href={`/ecritures/${e.id}`}
              className="flex items-center gap-3 px-3 py-2.5 text-[13px] transition-colors hover:bg-bg-sunken/40"
            >
              <span className="tabular-nums text-fg-subtle shrink-0">{e.date_ecriture}</span>
              <span className="min-w-0 flex-1 truncate text-fg">{e.description}</span>
              <span className="tabular-nums shrink-0">
                <Amount cents={e.amount_cents} tone="negative" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlocDepots({ titre, depots }: { titre: string; depots: DepotOrphelin[] }) {
  if (depots.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-[13.5px] font-medium text-fg">
        {titre}{' '}
        <span className="ml-1 inline-flex items-center rounded-full bg-bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
          {depots.length}
        </span>
      </h3>
      <ul className="divide-y divide-border-soft rounded-lg border border-border-soft overflow-hidden">
        {depots.map((d) => (
          <li key={d.id} className="px-3 py-2.5 text-[13px]">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-fg">
                {d.titre}
                <span className="text-fg-subtle">
                  {d.submitter_name && ` · ${d.submitter_name}`}
                  {d.date_estimee && ` · ${d.date_estimee}`}
                  {d.category_name && ` · ${d.category_name}`}
                </span>
              </span>
              {d.amount_cents !== null && (
                <span className="tabular-nums shrink-0">
                  <Amount cents={d.amount_cents} />
                </span>
              )}
            </div>
            {d.motif_rejet && (
              <p className="mt-0.5 text-[11.5px] text-fg-subtle">Rejeté : {d.motif_rejet}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Pastille d'état de la pièce : vert = justif attaché, ambre = manquant,
// gris = rien à attendre (recette, remboursement, justif non attendu).
function PastilleJustif({ ecriture }: { ecriture: BilanEcriture }) {
  const { couleur, titre } = ecriture.has_justificatif
    ? { couleur: 'bg-emerald-500', titre: 'Justificatif attaché' }
    : ecriture.type === 'recette'
      ? { couleur: 'bg-fg-subtle/40', titre: 'Recette' }
      : ecriture.remboursement_id
        ? { couleur: 'bg-fg-subtle/40', titre: 'Pièce sur la demande de remboursement' }
        : !ecriture.justif_attendu
          ? { couleur: 'bg-fg-subtle/40', titre: 'Justificatif non attendu' }
          : { couleur: 'bg-amber-500', titre: 'Justificatif manquant' };
  return <span className={`size-1.5 rounded-full shrink-0 ${couleur}`} title={titre} />;
}
