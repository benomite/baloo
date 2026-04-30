# Installation de Baloo en PWA

Baloo est livré comme **Progressive Web App** : pas besoin de passer
par l'App Store / Play Store, l'utilisateur installe directement depuis
son navigateur. Une fois installée, l'app se comporte comme une vraie
app native (icône, splash, plein écran sans chrome navigateur).

## Pour l'utilisateur

### Android (Chrome / Edge)

1. Ouvrir `https://baloo.benomite.com` dans Chrome.
2. Une **bannière "Installer Baloo"** apparaît en bas. Tap dessus.
3. Confirmer "Installer".

Si la bannière n'apparaît pas (déjà fermée auparavant) : menu Chrome
(⋮) → **Installer l'application**.

### iOS (Safari)

iOS ne propose pas d'install automatique, il faut faire la manip à la
main :

1. Ouvrir `https://baloo.benomite.com` dans Safari (pas Chrome iOS,
   qui ne supporte pas l'install PWA).
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
- **Pas d'offline** au MVP — sans réseau, l'app affiche l'écran
  "Pas de connexion" du navigateur. Pas de service worker.
- **Pas de notifications push** au MVP. À envisager plus tard si
  utile (Apple a activé les push web sur iOS 16.4+).

## Pour les devs

### Composants

- `web/src/app/manifest.ts` — manifest dynamique (Next.js Metadata API).
- `web/src/app/icon.tsx` (192×192) — icône principale, sert sur `/icon`.
- `web/src/app/icon1.tsx` (512×512) — icône large.
- `web/src/app/apple-icon.tsx` (180×180) — Apple Touch Icon.
- `web/src/app/layout.tsx` — `<meta name="apple-mobile-web-app-capable">`,
  `appleWebApp.title`, `viewport.themeColor`.
- `web/src/components/layout/mobile-nav.tsx` — top-bar mobile avec
  `padding-top: env(safe-area-inset-top)` pour iOS standalone.

### Modifier l'icône

Les icônes sont rendues à la volée par `next/og` (satori) depuis du
JSX simple. Pour changer le visuel (ex. remplacer l'emoji 🐻 par un
SVG custom de l'ours), éditer les 3 fichiers `icon.tsx`,
`icon1.tsx` et `apple-icon.tsx` en gardant les 3 tailles cohérentes.

Les `background_color` (crème) et `theme_color` (bleu marine SGDF)
du manifest doivent rester alignés sur les variables CSS
`--background` et `--brand` de `globals.css` — sinon le splash
screen mobile aura une couleur incohérente avec l'app au démarrage.

### Pas de service worker (encore)

Si on en a besoin un jour (offline, push), `next-pwa` ou un SW
custom suffit. Pour l'usage actuel (chefs / parents qui consultent
en ligne), pas urgent.
