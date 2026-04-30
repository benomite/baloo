'use client';

import { useEffect } from 'react';

// Enregistre le service worker `/sw.js` au chargement. Sans SW actif,
// Chrome refuse de proposer l'install PWA même avec un manifest
// valide. Le SW lui-même est minimal (pass-through, cf. public/sw.js).
//
// Erreurs ignorées : si l'enregistrement échoue (SW non supporté,
// HTTPS manquant en local, etc.), on log discrètement et on continue.

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        // Pas critique — l'app marche sans le SW, juste pas d'install
        // PWA proposée par Chrome.
        console.warn('[baloo-pwa] SW register failed:', err);
      });
    };

    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad);
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  return null;
}
