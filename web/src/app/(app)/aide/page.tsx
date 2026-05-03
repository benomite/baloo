import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Coins,
  FileText,
  Gift,
  HandCoins,
  Inbox,
  Mail,
  Paperclip,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/shared/section';
import { Alert } from '@/components/ui/alert';
import { getCurrentContext } from '@/lib/context';

const ROLE_LABEL: Record<string, string> = {
  tresorier: 'Trésorier',
  RG: 'Responsable de groupe',
  chef: "Chef d'unité",
  equipier: 'Équipier',
  parent: 'Parent',
};

export default async function AidePage() {
  const ctx = await getCurrentContext();
  const roleLabel = ROLE_LABEL[ctx.role] ?? ctx.role;
  const isAdmin = ctx.role === 'tresorier' || ctx.role === 'RG';
  const canSubmit = ctx.role !== 'parent';

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Aide & guide"
        subtitle={`Comment utiliser Baloo selon ton rôle (${roleLabel}). Si tu es bloqué après avoir lu ça, le trésorier est joignable depuis le bouton en bas de chaque page.`}
      />

      <Alert variant="info" className="mb-6">
        Baloo est l&apos;outil de comptabilité du groupe SGDF. Il sert à suivre l&apos;argent qui
        rentre et qui sort, à rembourser les bénévoles qui avancent des frais, et à émettre les
        reçus fiscaux pour ceux qui font des dons.
      </Alert>

      <div className="space-y-6">
        <RembsVsAbandonsSection canSubmit={canSubmit} />

        {canSubmit && (
          <Section
            title="Faire une demande de remboursement"
            subtitle="Quand tu as avancé des frais que tu veux récupérer."
          >
            <Steps>
              <Step icon={HandCoins} title="Va sur « Demander un remboursement »">
                Depuis la home (bouton « Demander un remboursement ») ou directement{' '}
                <CodeLink href="/moi/remboursements/nouveau">/moi/remboursements/nouveau</CodeLink>.
              </Step>
              <Step icon={Receipt} title="Remplis le détail des dépenses">
                Une ligne par ticket / facture (date + nature + montant). Le total se met à jour
                en direct. Tu peux ajouter autant de lignes que nécessaire.
              </Step>
              <Step icon={Paperclip} title="Joins les justificatifs">
                Photos, PDFs, scans — tout est accepté. Tu peux glisser-déposer plusieurs
                fichiers d&apos;un coup.
              </Step>
              <Step icon={CheckCircle2} title="Renseigne ton RIB une seule fois">
                À la 2e demande et au-delà, ton IBAN sera pré-rempli automatiquement depuis ta
                dernière demande.
              </Step>
              <Step icon={Mail} title="Tu reçois un mail à chaque étape">
                Validation Trésorier → Validation RG → Virement effectué → Terminé. Tu peux
                suivre l&apos;état de ta demande depuis la <CodeLink href="/">page d&apos;accueil</CodeLink>.
              </Step>
            </Steps>
          </Section>
        )}

        {canSubmit && (
          <Section
            title="Déclarer un abandon de frais"
            subtitle="Quand tu renonces au remboursement et préfères un reçu fiscal."
          >
            <Steps>
              <Step icon={FileText} title="Télécharge le formulaire SGDF">
                Disponible directement dans le formulaire de saisie. C&apos;est un xlsx à
                compléter et signer (à la main ou électroniquement).
              </Step>
              <Step icon={Gift} title="Remplis ta demande sur Baloo">
                Va sur{' '}
                <CodeLink href="/moi/abandons/nouveau">/moi/abandons/nouveau</CodeLink>. Tu
                renseignes la nature, le montant total, la date. Tu joins le PDF signé et les
                justificatifs.
              </Step>
              <Step icon={CheckCircle2} title="Le trésorier valide et envoie au national">
                Ta demande passe par : <em>À traiter</em> → <em>Validé</em> →{' '}
                <em>Envoyé au national</em> (donateurs@sgdf.fr).
              </Step>
              <Step icon={Receipt} title="Tu reçois ton CERFA par mail">
                Le service donateurs t&apos;envoie le reçu fiscal par mail{' '}
                <strong>sous 3 mois</strong>. Il ouvre droit à une réduction d&apos;impôt
                sur le revenu (art 200 CGI). À envoyer{' '}
                <strong>avant le 15 avril N+1</strong> pour les dépenses de l&apos;année N.
              </Step>
            </Steps>
          </Section>
        )}

        {canSubmit && (
          <Section
            title="Déposer un justif libre"
            subtitle="Pour les écritures où le trésorier rapproche après."
          >
            <p className="text-[13px] text-fg-muted leading-relaxed">
              Si tu as une facture, un reçu, ou un ticket à transmettre au trésorier (sans
              demande de remboursement), va sur{' '}
              <CodeLink href="/depot">Déposer un justif</CodeLink>. Le trésorier rapprochera
              ensuite avec l&apos;écriture comptable correspondante.
            </p>
          </Section>
        )}

        {isAdmin && <AdminSection />}

        <Section title="Tu ne trouves pas la réponse ?">
          <p className="text-[13px] text-fg-muted leading-relaxed">
            Le bouton{' '}
            <span className="inline-flex items-center gap-1 font-medium text-brand">
              Tu es bloqué ?
            </span>{' '}
            en bas de chaque page ouvre un mail pré-rempli vers le trésorier de ton groupe. Pas
            de support à faire à part répondre. Réponse sous 48h en moyenne.
          </p>
        </Section>
      </div>
    </div>
  );
}

function RembsVsAbandonsSection({ canSubmit }: { canSubmit: boolean }) {
  return (
    <Section
      title="Remboursement vs abandon de frais — c'est quoi la différence ?"
      subtitle="L'hésitation classique du bénévole qui a avancé des frais."
      className="scroll-mt-6"
    >
      <div id="rembs-vs-abandon" className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-4 space-y-2">
          <div className="flex items-center gap-2 text-brand">
            <HandCoins size={16} strokeWidth={1.75} />
            <h3 className="text-[14px] font-semibold">Remboursement</h3>
          </div>
          <p className="text-[12.5px] text-fg-muted leading-relaxed">
            Tu récupères ton argent par virement bancaire — c&apos;est un remboursement
            classique d&apos;une avance que tu as faite pour le groupe.
          </p>
          <ul className="text-[12px] text-fg space-y-1 list-disc pl-4">
            <li>Tu reçois 100 % du montant sur ton compte.</li>
            <li>Pas de réduction d&apos;impôts.</li>
            <li>Délai habituel : 1 à 3 semaines selon la validation.</li>
          </ul>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-2 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-200">
            <Gift size={16} strokeWidth={1.75} />
            <h3 className="text-[14px] font-semibold">Abandon de frais</h3>
          </div>
          <p className="text-[12.5px] text-fg-muted leading-relaxed">
            Tu renonces au remboursement, l&apos;argent reste pour le groupe → tu reçois un
            reçu fiscal CERFA qui ouvre droit à une réduction d&apos;impôt sur le revenu
            (art 200 CGI).
          </p>
          <ul className="text-[12px] text-fg space-y-1 list-disc pl-4">
            <li>Tu ne récupères pas l&apos;argent.</li>
            <li>
              Réduction d&apos;impôt sur le revenu — le taux dépend de ta situation fiscale,
              renseigne-toi sur impots.gouv.fr.
            </li>
            <li>
              Le reçu CERFA est émis par le national (donateurs@sgdf.fr), sous 3 mois après
              réception du formulaire signé.
            </li>
            <li>
              <strong>Date limite</strong> : déclaration à envoyer avant le{' '}
              <strong>15 avril N+1</strong> pour les dépenses de l&apos;année N (sinon le
              reçu est émis pour la déclaration N+2).
            </li>
          </ul>
        </div>
      </div>
      {canSubmit && (
        <div className="space-y-2 text-[12.5px] text-fg-muted leading-relaxed">
          <p>
            <strong className="text-fg">Frais éligibles à un abandon</strong> : seulement
            ceux engagés strictement pour la réalisation de l&apos;objet social de
            l&apos;association. Pas de contrepartie possible (les frais d&apos;inscription à
            une formation par exemple sont exclus). Factures internet et alcool refusées.
          </p>
          <p>
            <strong className="text-fg">Frais kilométriques</strong> : 0,354 €/km depuis
            septembre 2025. La copie de la carte grise du véhicule est obligatoire (la
            carte grise doit être au nom d&apos;un membre de ton foyer fiscal — pas une
            personne morale).
          </p>
        </div>
      )}
    </Section>
  );
}

function AdminSection() {
  return (
    <Section
      title="Workflow administratif (trésorier / RG)"
      subtitle="Les actions spécifiques à ton rôle."
    >
      <ul className="space-y-3 text-[13px] text-fg leading-relaxed">
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand mt-0.5">
            <Inbox size={13} strokeWidth={1.75} />
          </span>
          <div>
            <strong className="text-fg">Dépôts à rapprocher</strong> — quand un membre a déposé
            un justif libre, va sur <CodeLink href="/depots">Dépôts à traiter</CodeLink> pour
            l&apos;associer à l&apos;écriture comptable correspondante.
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand mt-0.5">
            <HandCoins size={13} strokeWidth={1.75} />
          </span>
          <div>
            <strong className="text-fg">Validation des remboursements</strong> — workflow à 2
            étages : Trésorier valide d&apos;abord, puis le RG. Une fois les 2 validations
            faites, signature électronique enregistrée et le virement peut partir.
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200 mt-0.5">
            <Gift size={13} strokeWidth={1.75} />
          </span>
          <div>
            <strong className="text-fg">Abandons de frais</strong> — valider la demande, puis
            cliquer «&nbsp;Ouvrir le mail&nbsp;» pour préparer l&apos;envoi à donateurs@sgdf.fr
            avec la feuille signée en pièce jointe. Marquer ensuite «&nbsp;Envoyé&nbsp;». Quand
            le CERFA arrive en retour, cliquer «&nbsp;CERFA reçu&nbsp;».
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand mt-0.5">
            <Coins size={13} strokeWidth={1.75} />
          </span>
          <div>
            <strong className="text-fg">Caisse</strong> — entrées / sorties en espèces du
            groupe, avec solde calculé en direct.
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand mt-0.5">
            <BookOpen size={13} strokeWidth={1.75} />
          </span>
          <div>
            <strong className="text-fg">Comptaweb</strong> — Baloo lit les écritures et
            rapprochements bancaires depuis Comptaweb (auth automatique). Source de vérité
            comptable, Baloo est la couche opérationnelle.
          </div>
        </li>
      </ul>
    </Section>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="space-y-3">{children}</ol>;
}

function Step({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand mt-0.5">
        <Icon size={14} strokeWidth={1.75} />
      </span>
      <div>
        <div className="text-[13.5px] font-medium text-fg">{title}</div>
        <p className="mt-0.5 text-[12.5px] text-fg-muted leading-relaxed">{children}</p>
      </div>
    </li>
  );
}

function CodeLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 rounded-md bg-brand-50/60 px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-brand hover:bg-brand-100 transition-colors"
    >
      {children}
      <ArrowRight size={11} strokeWidth={2.25} className="ml-0.5" />
    </Link>
  );
}

