import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  HandCoins,
  Receipt,
  Wallet,
  Users,
  ShieldCheck,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

function GithubMark(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={props.className}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.58.11.79-.25.79-.55v-2.07c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 2.89-.39c.98 0 1.97.13 2.89.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.13v3.16c0 .31.21.66.8.55C20.22 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

// Landing publique de Baloo. Indexable, sans auth. Pour SEO + découverte.
// Cf. doc/distribution.md.

export const metadata: Metadata = {
  title: 'Baloo — Le carnet du trésorier d\'un groupe SGDF',
  description:
    "Webapp et serveur MCP pour tenir la compta opérationnelle d'un groupe Scouts et Guides de France : remboursements, abandons de frais, justificatifs, caisse, budgets par unité. Open source, sync Compta-Web.",
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'Baloo — Le carnet du trésorier SGDF',
    description:
      "L'outil open source qui aide les trésoriers de groupes Scouts et Guides de France à tenir la compta opérationnelle de leur groupe.",
    url: 'https://baloo.benomite.com/about',
    siteName: 'Baloo',
    locale: 'fr_FR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Baloo — Le carnet du trésorier SGDF',
    description:
      "L'outil open source qui aide les trésoriers de groupes SGDF à tenir leur compta opérationnelle.",
  },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-bg">
      <PublicNav />

      <main className="max-w-5xl mx-auto px-4 py-12 lg:py-20">
        <Hero />
        <Features />
        <ForWhom />
        <HowItWorks />
        <Tech />
        <FAQ />
        <CTA />
      </main>

      <PublicFooter />

      <StructuredData />
    </div>
  );
}

function PublicNav() {
  return (
    <nav className="border-b border-border-soft bg-bg-elevated/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/about" className="flex items-center gap-2 font-display text-lg">
          <span className="text-2xl" aria-hidden>
            🐻
          </span>
          <span className="font-semibold">Baloo</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="https://github.com/benomite/baloo"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-fg-muted hover:text-fg rounded-md"
          >
            <GithubMark className="h-4 w-4" />
            GitHub
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 bg-brand text-brand-fg hover:bg-brand-hover px-3 py-1.5 text-sm rounded-md font-medium transition-colors"
          >
            Se connecter
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="py-12 lg:py-16 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-brand-50 text-brand text-sm">
        <Sparkles className="h-3.5 w-3.5" />
        Open source · MIT · Bénévole pour bénévoles
      </div>

      <h1 className="font-display text-4xl lg:text-6xl font-bold tracking-tight mb-6">
        Le carnet du trésorier
        <br />
        <span className="text-brand">d&apos;un groupe SGDF</span>
      </h1>

      <p className="text-lg lg:text-xl text-fg-muted max-w-2xl mx-auto mb-8">
        Une webapp qui aide les trésoriers de groupes Scouts et Guides de France à tenir
        la compta opérationnelle de leur groupe : remboursements, abandons de frais,
        justificatifs, caisse, budgets par unité. <strong>Sync avec Compta-Web</strong>,
        sans jamais le remplacer.
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 bg-brand text-brand-fg hover:bg-brand-hover px-5 py-3 rounded-md font-medium transition-colors w-full sm:w-auto"
        >
          Se connecter à mon groupe
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="https://github.com/benomite/baloo"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 border border-border hover:border-border-strong px-5 py-3 rounded-md font-medium transition-colors w-full sm:w-auto"
        >
          <GithubMark className="h-4 w-4" />
          Voir le code
        </Link>
      </div>

      <p className="mt-6 text-sm text-fg-subtle">
        En prod chez l&apos;auteur (groupe Val de Saône) depuis 2026.
      </p>
    </section>
  );
}

function Features() {
  const features: { icon: LucideIcon; title: string; desc: string }[] = [
    {
      icon: Receipt,
      title: 'Écritures et rapprochement',
      desc: "Import CSV Comptaweb, sync des écritures, rapprochement bancaire DSP2 (sous-lignes de paiement enrichies).",
    },
    {
      icon: HandCoins,
      title: 'Remboursements',
      desc: 'Feuilles multi-lignes, signature électronique, génération PDF, 5 statuts, notifs email à chaque étape.',
    },
    {
      icon: Wallet,
      title: 'Caisse et chèques',
      desc: 'Mouvements de caisse synchronisés avec Comptaweb, dépôts de chèques (banque + ANCV), abandons de frais avec CERFA.',
    },
    {
      icon: Users,
      title: 'Budgets par unité',
      desc: "Vue par unité (Farfadets, LJ, SG, Pi, Co, Groupe), prévisionnel, répartitions inter-unités, audit de couverture.",
    },
    {
      icon: Smartphone,
      title: 'PWA mobile',
      desc: 'Installable sur Chrome et iOS. Les chefs déposent leurs justifs depuis leur téléphone, sans email.',
    },
    {
      icon: ShieldCheck,
      title: 'RGPD pris au sérieux',
      desc: 'Magic link sans mot de passe, justifs en blob privé avec URLs signées, données minimales sur les mineurs.',
    },
  ];

  return (
    <section className="py-12 lg:py-16">
      <h2 className="font-display text-3xl lg:text-4xl font-bold text-center mb-12">
        Ce que Baloo sait faire
      </h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f) => (
          <div
            key={f.title}
            className="p-5 rounded-lg border border-border bg-bg-elevated"
          >
            <div className="inline-flex p-2 rounded-md bg-brand-50 text-brand mb-3">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="font-semibold mb-1.5">{f.title}</h3>
            <p className="text-sm text-fg-muted">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ForWhom() {
  const personas = [
    {
      role: 'Trésorier·ère',
      desc: "Tu veux automatiser ce qui peut l'être (rapprochement DSP2, relances justificatifs, états mensuels) et garder une vue claire.",
    },
    {
      role: "Chef·fe d'unité",
      desc: 'Tu veux suivre le budget de ton unité et déposer tes justifs depuis ton mobile, sans envoyer un email à chaque fois.',
    },
    {
      role: 'Parent / donateur',
      desc: 'Tu veux voir tes paiements au groupe et récupérer ton reçu fiscal en autonomie.',
    },
    {
      role: 'Curieux MCP',
      desc: "Un cas réel d'app full-stack avec un serveur MCP qui agit comme client HTTP de la webapp, utilisable depuis Claude Code.",
    },
  ];

  return (
    <section className="py-12 lg:py-16 border-t border-border-soft">
      <h2 className="font-display text-3xl lg:text-4xl font-bold text-center mb-12">
        Pour qui ?
      </h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {personas.map((p) => (
          <div
            key={p.role}
            className="p-5 rounded-lg border border-border bg-bg-elevated"
          >
            <h3 className="font-semibold text-brand mb-1.5">{p.role}</h3>
            <p className="text-sm text-fg-muted">{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="py-12 lg:py-16 border-t border-border-soft">
      <h2 className="font-display text-3xl lg:text-4xl font-bold text-center mb-4">
        Comment ça marche
      </h2>
      <p className="text-center text-fg-muted mb-12 max-w-2xl mx-auto">
        Compta-Web reste la source de vérité comptable imposée par la fédération. Baloo
        travaille en amont : il aide à préparer, à matcher, à relancer — pas à remplacer.
      </p>
      <ol className="space-y-4 max-w-2xl mx-auto">
        {[
          {
            title: '1. Import depuis Comptaweb',
            desc: "Export CSV ou sync API (auth Keycloak automatisée). Les écritures et lignes bancaires arrivent dans Baloo.",
          },
          {
            title: '2. Travail opérationnel dans Baloo',
            desc: "Tu rapproches, tu catégorises, tu valides les remboursements. Les chefs déposent leurs justifs. Les parents consultent leur reçu fiscal.",
          },
          {
            title: '3. Saisie dans Compta-Web',
            desc: "Baloo te prépare les données pré-formatées prêtes à recopier. À terme, automation navigateur sur les opérations simples.",
          },
        ].map((step) => (
          <li
            key={step.title}
            className="p-5 rounded-lg border border-border bg-bg-elevated"
          >
            <h3 className="font-semibold mb-1.5">{step.title}</h3>
            <p className="text-sm text-fg-muted">{step.desc}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Tech() {
  return (
    <section className="py-12 lg:py-16 border-t border-border-soft">
      <h2 className="font-display text-3xl lg:text-4xl font-bold text-center mb-12">
        Stack technique
      </h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        {[
          ['Framework', 'Next.js 16, App Router'],
          ['Langage', 'TypeScript strict'],
          ['Base de données', 'Turso (libSQL)'],
          ['Auth', 'NextAuth v5, magic link'],
          ['Stockage', 'Vercel Blob privé'],
          ['Email', 'Resend'],
          ['UI', 'Tailwind v4, base-ui'],
          ['MCP', 'Model Context Protocol'],
        ].map(([label, value]) => (
          <div
            key={label}
            className="p-4 rounded-md border border-border bg-bg-elevated"
          >
            <div className="text-xs text-fg-subtle">{label}</div>
            <div className="font-medium">{value}</div>
          </div>
        ))}
      </div>
      <p className="text-center text-sm text-fg-muted mt-6">
        Le code est sur{' '}
        <Link
          href="https://github.com/benomite/baloo"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-fg"
        >
          GitHub
        </Link>
        , sous licence MIT.
      </p>
    </section>
  );
}

function FAQ() {
  const items = [
    {
      q: 'Est-ce un outil officiel des Scouts et Guides de France ?',
      a: "Non. C'est un projet indépendant développé par un bénévole pour les bénévoles. La fédération n'est pas impliquée. Compta-Web reste l'outil officiel SGDF et la source de vérité comptable.",
    },
    {
      q: 'Mon groupe peut-il l\'utiliser ?',
      a: "À ce stade, l'instance hébergée publiquement est dimensionnée pour un seul groupe (Val de Saône). Le code est open source : tu peux l'auto-héberger. Le multi-groupes hébergé est sur la roadmap (phase 3).",
    },
    {
      q: 'Comment sont protégées les données ?',
      a: "Auth par magic link (pas de mot de passe stocké), justifs en stockage blob privé avec URLs signées, données minimales sur les mineurs, pre-commit hook qui bloque les fuites de données nominatives. Cf. SECURITY.md et doc/security-rgpd.md.",
    },
    {
      q: 'Pourquoi le nom Baloo ?',
      a: "L'ours bienveillant du Livre de la Jungle, mascotte des scouts. Il accompagne et veille, sans faire à la place.",
    },
    {
      q: 'Comment contribuer ?',
      a: "Ouvre une issue sur GitHub. PRs bienvenues après discussion. Pour les bugs de sécurité, utilise GitHub Security Advisories. Cf. CONTRIBUTING.md.",
    },
  ];

  return (
    <section className="py-12 lg:py-16 border-t border-border-soft">
      <h2 className="font-display text-3xl lg:text-4xl font-bold text-center mb-12">
        Questions fréquentes
      </h2>
      <div className="space-y-3 max-w-3xl mx-auto">
        {items.map((item) => (
          <details
            key={item.q}
            className="group p-5 rounded-lg border border-border bg-bg-elevated"
          >
            <summary className="font-semibold cursor-pointer marker:hidden flex items-center justify-between">
              {item.q}
              <span className="text-fg-subtle group-open:rotate-90 transition-transform">
                ›
              </span>
            </summary>
            <p className="mt-3 text-sm text-fg-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-12 lg:py-16 border-t border-border-soft">
      <div className="p-8 lg:p-12 rounded-xl bg-brand text-brand-fg text-center">
        <h2 className="font-display text-2xl lg:text-3xl font-bold mb-3">
          Envie d&apos;essayer ?
        </h2>
        <p className="opacity-90 mb-6 max-w-xl mx-auto">
          Si tu es trésorier·ère d&apos;un groupe SGDF et tu veux un coup de main, ouvre
          une issue sur GitHub. Si tu es curieux du code, c&apos;est par là.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="https://github.com/benomite/baloo/issues/new/choose"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-white text-brand hover:bg-white/90 px-5 py-3 rounded-md font-medium transition-colors w-full sm:w-auto"
          >
            Ouvrir une issue
          </Link>
          <Link
            href="https://github.com/benomite/baloo"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 border border-white/30 hover:border-white/60 px-5 py-3 rounded-md font-medium transition-colors w-full sm:w-auto"
          >
            <GithubMark className="h-4 w-4" />
            Star sur GitHub
          </Link>
        </div>
      </div>
    </section>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-border-soft py-8 mt-12">
      <div className="max-w-5xl mx-auto px-4 text-sm text-fg-subtle text-center space-y-2">
        <p>
          Baloo — Open source MIT —{' '}
          <Link
            href="https://github.com/benomite/baloo"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-fg-muted"
          >
            github.com/benomite/baloo
          </Link>
        </p>
        <p className="text-xs">
          Projet indépendant. Pas affilié aux Scouts et Guides de France.
        </p>
      </div>
    </footer>
  );
}

function StructuredData() {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Baloo',
    description:
      "Webapp pour tenir la compta opérationnelle d'un groupe Scouts et Guides de France.",
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    license: 'https://opensource.org/licenses/MIT',
    url: 'https://baloo.benomite.com/about',
    codeRepository: 'https://github.com/benomite/baloo',
    programmingLanguage: 'TypeScript',
    inLanguage: 'fr',
  };

  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires raw JSON
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
