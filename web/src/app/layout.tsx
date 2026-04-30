import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Geist } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import './globals.css';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] });

// Bricolage Grotesque : grotesque française moderne, expressive sans
// préciosité, axes opsz + wdth qui adaptent la lettre à la taille.
// Utilisée uniquement comme `font-display` sur des titres COURTS
// (`<50 chars`, pas en CAPS). Le PageHeader bascule automatiquement
// sur Geist pour les titres longs (libellés bancaires bruts par ex.)
// — cf. components/layout/page-header.tsx.
const bricolage = Bricolage_Grotesque({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Baloo · Compta SGDF',
    template: '%s · Baloo',
  },
  description: 'Comptabilité du groupe SGDF.',
  applicationName: 'Baloo',
  appleWebApp: {
    capable: true,
    title: 'Baloo',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  // Pas de `maximumScale: 1` : on laisse l'utilisateur zoomer
  // (accessibilité + utile pour relire un montant en mobile).
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1a3a6c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${geist.variable} ${bricolage.variable} h-full`}>
      <body className="h-full flex antialiased">
        {children}
        <Toaster />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
