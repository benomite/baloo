# Installation de Baloo en PWA

Baloo est livré comme **Progressive Web App** : pas besoin de passer
par l'App Store / Play Store, l'utilisateur installe directement depuis
son navigateur. Une fois installée, l'app se comporte comme une vraie
app native (icône, splash, plein écran sans chrome navigateur).

## Pour l'utilisateur

### Android (Chrome / Edge)

1. Ouvrir `https://baloo.benomite.com` dans Chrome.
2. Naviguer un peu dans l'app (login + visite de quelques pages).
3. Soit la **bannière "Installer Baloo"** apparaît automatiquement en
   bas (Chrome a sa propre heuristique d'engagement, ce n'est pas
   garanti immédiatement), soit on tape sur le bouton **"Installer
   Baloo"** présent dans le footer de la sidebar / drawer mobile.
4. Confirmer "Installer" dans la popup.

Si rien n'apparaît : menu Chrome (⋮) → **Installer l'application**.

> **Firefox Android** ne propose pas une vraie install PWA — juste un
> raccourci. On recommande Chrome / Edge / Samsung Internet.

### iOS (Safari)

iOS ne fournit pas le bouton d'install automatique (limitation WebKit
non négociable), il faut faire la manip à la main :

1. Ouvrir `https://baloo.benomite.com` dans **Safari**. Pas Chrome iOS,
   pas Firefox iOS — ils utilisent WebKit aussi mais ne proposent pas
   l'option "Ajouter à l'écran d'accueil" pour les PWA.
2. Tap le bouton **Partager** (icône carré + flèche en bas).
3. Faire défiler et tap **"Ajouter à l'écran d'accueil"**.
4. Confirmer "Ajouter".

L'icône Baloo (🐻 sur fond bleu marine SGDF) apparaît sur l'écran
d'accueil. Tap dessus = ouverture en plein écran (sans la barre
d'URL Safari), comme une vraie app.

## Ce qui est gardé

- **Compte connecté** : la session NextAuth (cookie 30 jours) est
  conservée tant que la PWA est utilisée régulièrement. Pas de
  re-login si l'utilisateur revient dans la semaine.
- **Liens vers Baloo** ouvrent l'app installée (au lieu du navigateur)
  une fois la PWA installée. Ça inclut **les magic links de
  connexion** : tap dans Mail → ouvre directement la PWA.

## Limites connues

- **iOS / Safari** purge les données (cookies inclus) après ~7 jours
  d'inactivité totale. Si l'utilisateur n'ouvre pas Baloo pendant
  une semaine, il devra re-cliquer un magic link à la prochaine
  ouverture. Acceptable pour un usage régulier.
- **Pas d'offline applicatif** : sans réseau, l'app affiche l'écran
  "Pas de connexion" du navigateur. Le service worker en place est
  volontairement minimal (pas de cache).
- **Pas de notifications push** au MVP. À envisager plus tard si
  utile (Apple a activé les push web sur iOS 16.4+).
- **Firefox** propose un raccourci "Add to Home screen" mais sans
  vraie install PWA (pas de standalone, pas d'isolation cookies de
  Firefox principal). Recommander Chrome / Edge à la place.

## Pour les devs

### Composants

- `web/src/app/manifest.ts` — manifest dynamique (Next.js Metadata API)
  servi sur `/manifest.webmanifest`.
- `web/src/app/icon.tsx` (192×192) — icône principale, sert sur `/icon`.
- `web/src/app/icon1.tsx` (512×512) — icône large, sert sur `/icon1`.
- `web/src/app/apple-icon.tsx` (180×180) — Apple Touch Icon, sert sur
  `/apple-icon`.
- `web/src/app/layout.tsx` — metadata `applicationName`, `appleWebApp`
  (capable + title + statusBarStyle), `viewport.themeColor`.
- `web/src/components/layout/mobile-nav.tsx` — top-bar mobile avec
  `padding-top: env(safe-area-inset-top)` pour iOS standalone (sinon le
  notch mange la barre).
- `web/public/sw.js` — service worker minimal (pass-through).
- `web/src/components/pwa/sw-register.tsx` — register du SW au load.
- `web/src/components/pwa/install-button.tsx` — bouton "Installer
  Baloo" qui apparaît quand le navigateur émet `beforeinstallprompt`.

### Modifier l'icône

Les icônes sont rendues à la volée par `next/og` (satori) depuis du
JSX simple. Pour changer le visuel (ex. remplacer l'emoji 🐻 par un
SVG custom de l'ours), éditer les 3 fichiers `icon.tsx`,
`icon1.tsx` et `apple-icon.tsx` en gardant les 3 tailles cohérentes.

Les `background_color` (crème) et `theme_color` (bleu marine SGDF)
du manifest doivent rester alignés sur les variables CSS
`--background` et `--brand` de `globals.css` — sinon le splash
screen mobile aura une couleur incohérente avec l'app au démarrage.

### Pourquoi un service worker

Chrome / Edge sur Android **refusent** de proposer la bannière
d'install PWA tant qu'un service worker n'est pas actif sur le site,
même avec un manifest valide et HTTPS. C'est dans les critères
d'éligibilité Chrome :
<https://web.dev/articles/install-criteria>.

Le SW de Baloo (`web/public/sw.js`) est volontairement **minimal** :

- Handlers `install` (skipWaiting), `activate` (clients.claim), `fetch`
  (no-op pass-through). Le `fetch` doit être déclaré, sinon Chrome
  considère qu'il n'y a pas de SW utile.
- Pas de cache — donc pas de risque de servir du contenu stale.
- Pas d'offline — si on en a besoin un jour, on switche pour `next-pwa`,
  Workbox, ou un SW custom plus riche.

Sa raison d'être unique : **débloquer l'install banner**. Tout le
reste fonctionne aussi bien sans SW.

### Le bouton custom "Installer Baloo"

Même avec un SW actif, Chrome n'affiche pas toujours la banner
automatiquement (heuristique d'engagement opaque, deferred install
prompt, l'utilisateur peut avoir cliqué "non" auparavant). On capte
l'event `beforeinstallprompt` et on l'expose via un bouton custom
dans la sidebar (`<InstallButton>`). Le bouton :

- Est **caché par défaut** (l'event peut arriver après quelques
  secondes ou pas du tout).
- **Apparaît** dès que le navigateur dit que l'install est possible.
- **Disparaît** quand l'app est installée (event `appinstalled` ou
  détection `display-mode: standalone` au mount).

iOS Safari ne fournit pas `beforeinstallprompt` (pas dans WebKit),
donc le bouton reste caché — l'utilisateur passe par la procédure
manuelle Partager → Ajouter à l'écran d'accueil.

### Test du install prompt

En dev local : impossible de tester directement (HTTP non éligible
PWA). Soit utiliser ngrok / cloudflare tunnel pour servir en HTTPS,
soit tester sur un preview Vercel.

Sur Chrome desktop : ouvrir DevTools → Application → Manifest pour
voir si tous les critères PWA sont validés. Si "Installable" est
coché, l'install marchera sur Android.
