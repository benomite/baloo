import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { Sidebar } from '@/components/layout/sidebar';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Baloo Compta',
  description: 'Outil de comptabilité pour groupe SGDF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${geist.variable} h-full`}>
      <body className="h-full flex antialiased">
        <Sidebar />
        <main className="flex-1 overflow-auto p-8">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
