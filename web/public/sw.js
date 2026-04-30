// Service worker minimal pour Baloo.
//
// Rôle unique au MVP : satisfaire le critère "install banner" de
// Chrome / Edge sur Android. Sans SW, le navigateur **refuse** de
// proposer "Installer cette application" — même avec un manifest
// valide, des icônes et HTTPS.
//
// Stratégie : pass-through. On n'intercepte rien, on ne cache rien.
// Du coup pas de risque de servir du contenu stale, pas d'offline,
// mais l'install est débloqué.
//
// Si on veut de l'offline plus tard, on passera à un vrai SW
// (next-pwa, workbox, ou custom).

self.addEventListener('install', (event) => {
  // skipWaiting : prend la place de l'ancien SW immédiatement, sans
  // attendre que tous les onglets soient fermés. Évite de rester
  // coincé sur une vieille version.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // clients.claim : prend le contrôle des pages déjà ouvertes (sinon
  // il faut un reload pour que le SW agisse).
  event.waitUntil(self.clients.claim());
});

// Fetch handler obligatoire (même no-op) : sans, Chrome considère
// qu'il n'y a pas de SW et refuse l'install banner.
self.addEventListener('fetch', () => {
  // Pass-through : on laisse le navigateur faire son fetch standard.
});
