import type { Metadata } from 'next';
import { Fraunces, Geist } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] });

// Fraunces : serif moderne avec un peu de chaleur (italics natifs).
// Utilisée uniquement sur les page titles via la classe `font-display`
// — le body reste en Geist (lisibilité, dense). Donne un contraste
// "magazine" qui réchauffe sans sacrifier la lisibilité financière.
const fraunces = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  // Pas de `weight` : on prend la version variable et on ajuste axe SOFT
  // pour adoucir les empattements (style un peu plus chaleureux que la
  // Fraunces "tranchante" par défaut).
  axes: ['SOFT', 'opsz'],
});

export const metadata: Metadata = {
  title: 'Baloo Compta',
  description: 'Outil de comptabilité pour groupe SGDF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${geist.variable} ${fraunces.variable} h-full`}>
      <body className="h-full flex antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
