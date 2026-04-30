import type { MetadataRoute } from 'next';

// Manifest PWA dynamique. Sert sur `/manifest.webmanifest` automatiquement.
//
// Une fois la PWA installée :
//   - Android Chrome : install prompt natif (bannière "Installer Baloo").
//   - iOS Safari : pas d'install prompt, l'utilisateur fait
//     Partager → Ajouter à l'écran d'accueil.
//   - Les liens vers `baloo.benomite.com` ouvrent l'app installée
//     (display: 'standalone' + scope sur la racine).
//
// Pas de service worker au MVP : pas d'offline ni de notifications
// push, pas urgent pour l'usage prévu (chefs qui déposent un justif
// en réseau standard).

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Baloo Compta',
    short_name: 'Baloo',
    description: 'Comptabilité du groupe SGDF',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    // Crème (= --background) pour matcher le fond de l'app au splash.
    background_color: '#fbfaf6',
    // Bleu marine SGDF (= --brand) pour la barre d'état.
    theme_color: '#1a3a6c',
    lang: 'fr',
    categories: ['finance', 'productivity', 'utilities'],
    icons: [
      {
        src: '/icon',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon1',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
