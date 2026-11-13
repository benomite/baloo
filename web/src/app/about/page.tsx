import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, MessagesSquare, Paperclip, type LucideIcon } from 'lucide-react';

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

// Présentation publique de Baloo, sans auth. C'est aussi la home des
// visiteurs non connectés : `proxy.ts` réécrit `/` vers cette page quand il
// n'y a pas de cookie de session (#21). Ton voulu : sobre, factuel — on dit
// à quoi ça sert, pas plus. Cf. doc/distribution.md.

export const metadata: Metadata = {
  title: 'Baloo — Le carnet du trésorier d\'un groupe SGDF',
  description:
    "Baloo aide un groupe Scouts et Guides de France à gérer ses process et ses pièces (remboursements, justificatifs, abandons de frais, caisse, camps) et branche Claude sur Compta-Web via un serveur MCP. Open source.",
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'Baloo — Le carnet du trésorier SGDF',
    description:
      "Les process et les pièces d'un groupe SGDF au même endroit, et Claude branché sur Compta-Web. Open source.",
    url: 'https://baloo.benomite.com/about',
    siteName: 'Baloo',
    locale: 'fr_FR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Baloo — Le carnet du trésorier SGDF',
    description:
      "Les process et les pièces d'un groupe SGDF au même endroit, et Claude branché sur Compta-Web.",
  },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-bg">
      <PublicNav />

      <main className="max-w-4xl mx-auto px-4 py-10 lg:py-16">
        <Hero />
        <Interests />
        <Access />
        <FAQ />
      </main>

      <PublicFooter />

      <StructuredData />
    </div>
  );
}

function PublicNav() {
  return (
    <nav className="border-b border-border-soft bg-bg-elevated/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-display text-lg">
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
    <section className="py-8 lg:py-12">
      <h1 className="font-display text-4xl lg:text-5xl font-bold tracking-tight mb-5">
        Le carnet du trésorier
        <br />
        <span className="text-brand">d&apos;un groupe SGDF</span>
      </h1>

      <p className="text-lg text-fg-muted max-w-2xl mb-8">
        Baloo aide un groupe Scouts et Guides de France à tenir sa compta au
        quotidien. Il travaille à côté de Compta-Web, qui reste la compta officielle
        du groupe : il ne le remplace pas.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 bg-brand text-brand-fg hover:bg-brand-hover px-5 py-3 rounded-md font-medium transition-colors w-full sm:w-auto"
        >
          Se connecter
          <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="text-sm text-fg-subtle">
          Accès sur invitation : demande-le au trésorier de ton groupe.
        </p>
      </div>
    </section>
  );
}

// Les 2 intérêts de Baloo (#21), chacun avec son public.
function Interests() {
  const interests: {
    icon: LucideIcon;
    audience: string;
    title: string;
    desc: string;
    points: string[];
  }[] = [
    {
      icon: Paperclip,
      audience: 'Pour les chefs, les parents et le trésorier',
      title: 'Gérer les process et les fichiers du groupe',
      desc: "Chacun fait sa démarche lui-même, depuis son téléphone ou son ordinateur, et les pièces arrivent rangées au bon endroit, reliées aux écritures qu'elles justifient.",
      points: [
        'Remboursements : la demande se dépose en ligne, et se suit.',
        'Justificatifs : déposés directement, sans passer par un mail.',
        'Abandons de frais, avec le CERFA.',
        'Caisse et camps.',
      ],
    },
    {
      icon: MessagesSquare,
      audience: 'Pour le trésorier',
      title: 'Connecter Claude à Compta-Web',
      desc: "Baloo expose un serveur MCP : depuis Claude (Code ou Desktop), le trésorier pilote la compta du groupe en conversation. Baloo sert de miroir de Compta-Web, qui reste la source de vérité.",
      points: [
        'Synchronisation des écritures avec Compta-Web.',
        'Brouillons préparés à partir des lignes bancaires pas encore rapprochées.',
        'Aide au rapprochement bancaire.',
      ],
    },
  ];

  return (
    <section className="py-8 lg:py-12 border-t border-border-soft">
      <h2 className="font-display text-2xl lg:text-3xl font-bold mb-8">
        À quoi sert Baloo
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        {interests.map((i) => (
          <div
            key={i.title}
            className="p-5 lg:p-6 rounded-lg border border-border bg-bg-elevated"
          >
            <div className="inline-flex p-2 rounded-md bg-brand-50 text-brand mb-4">
              <i.icon className="h-5 w-5" />
            </div>
            <p className="text-overline mb-1.5">{i.audience}</p>
            <h3 className="font-semibold text-lg mb-2">{i.title}</h3>
            <p className="text-sm text-fg-muted mb-4">{i.desc}</p>
            <ul className="space-y-1.5 text-sm">
              {i.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="text-fg-subtle" aria-hidden>
                    —
                  </span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// Pas de self-signup : l'accès passe par une invitation du trésorier.
function Access() {
  return (
    <section className="py-8 lg:py-12 border-t border-border-soft">
      <h2 className="font-display text-2xl lg:text-3xl font-bold mb-4">
        Comment y accéder
      </h2>
      <div className="space-y-3 text-fg-muted max-w-2xl">
        <p>
          Il n&apos;y a pas d&apos;inscription libre. Le trésorier de ton groupe
          t&apos;ouvre un accès : demande-le lui.
        </p>
        <p>
          Une fois ton accès ouvert,{' '}
          <Link href="/login" className="underline text-fg hover:text-brand">
            connecte-toi
          </Link>{' '}
          avec ton adresse mail : tu reçois un lien et un code, sans mot de passe.
        </p>
        <p>
          Ton groupe n&apos;utilise pas Baloo ? Le code est ouvert : tu peux en parler
          en{' '}
          <Link
            href="https://github.com/benomite/baloo/issues/new/choose"
            target="_blank"
            rel="noreferrer"
            className="underline text-fg hover:text-brand"
          >
            ouvrant une issue sur GitHub
          </Link>
          .
        </p>
      </div>
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
      q: 'Comment sont protégées les données ?',
      a: "Connexion sans mot de passe (lien ou code par mail), justificatifs en stockage privé avec URLs signées, données minimales sur les mineurs. Cf. SECURITY.md et doc/security-rgpd.md.",
    },
    {
      q: 'Pourquoi le nom Baloo ?',
      a: "L'ours bienveillant du Livre de la Jungle, mascotte des scouts. Il accompagne et veille, sans faire à la place.",
    },
  ];

  return (
    <section className="py-8 lg:py-12 border-t border-border-soft">
      <h2 className="font-display text-2xl lg:text-3xl font-bold mb-6">
        Questions fréquentes
      </h2>
      <div className="space-y-3">
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

function PublicFooter() {
  return (
    <footer className="border-t border-border-soft py-8 mt-8">
      <div className="max-w-4xl mx-auto px-4 text-sm text-fg-subtle text-center space-y-2">
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
