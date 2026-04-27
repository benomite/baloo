# Déploiement Baloo (chantier 7 P2)

Procédure pour passer Baloo de dev local à un environnement de production accessible via `baloo.benomite.com`. Cf. [ADR-017](decisions.md#adr-017--bdd-production--sqlite-hébergée-turso-plutôt-que-postgres) (BDD = Turso) et [ADR-018](decisions.md#adr-018--hébergement--vercel--turso-pour-le-mvp-intra-groupe) (hébergement = Vercel).

Cible : trésorier bénévole, ~5-10 users, 0 € de budget récurrent au MVP.

---

## 1. Préparer Turso (BDD prod)

```sh
# 1. Installer le CLI Turso (https://docs.turso.tech)
brew install turso  # ou curl -sSfL https://get.tur.so/install.sh | bash

# 2. Login
turso auth signup    # ou turso auth login

# 3. Créer une BDD
turso db create baloo-prod --location cdg  # CDG = Paris

# 4. Récupérer l'URL de connexion
turso db show baloo-prod --url
# → libsql://baloo-prod-<org>.turso.io

# 5. Générer un token read-write
turso db tokens create baloo-prod --expiration none
# → eyJ... (long string)
```

**À noter** : Turso free tier autorise 500 BDD, 9 GB total, backups quotidiens managés. Largement suffisant pour 1 groupe.

### Migration des données dev → Turso

```sh
# Depuis la racine du repo
turso db shell baloo-prod < <(sqlite3 data/baloo.db .dump)
```

Vérifier ensuite :
```sh
turso db shell baloo-prod "SELECT COUNT(*) FROM ecritures;"
```

### Migration des justificatifs locaux → Vercel Blob

À faire **après** avoir créé le Blob côté Vercel (cf. § 4) et migré la BDD :

```sh
cd web
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... \
DB_URL=libsql://baloo-prod-<org>.turso.io \
DB_AUTH_TOKEN=... \
pnpm migrate:justifs-to-blob
```

Le script lit la table `justificatifs` (depuis Turso si `DB_URL` est défini, sinon SQLite local), vérifie pour chaque ligne si le fichier est déjà sur Blob (via `head()`), et upload sinon. Idempotent : peut être relancé plusieurs fois sans dupliquer.

La BDD n'a **pas** besoin d'être mise à jour : le champ `file_path` (`<entity_type>/<entity_id>/<filename>`) est identique entre les deux backends.

---

## 2. Préparer Resend (envoi magic link)

1. Créer un compte sur https://resend.com (free tier : 100 emails/jour, 3000/mois).
2. Vérifier le domaine `benomite.com` (ajouter les DNS records SPF/DKIM fournis).
3. Créer une API key (Settings → API Keys → Create).
4. Format SMTP pour Auth.js : `smtp://resend:re_xxxxxxxxxxxx@smtp.resend.com:465`.

---

## 3. Préparer Vercel Blob (justificatifs)

Le storage Vercel Blob est provisionné depuis le dashboard Vercel après le premier deploy. Cf. section 4.

---

## 4. Déployer sur Vercel

### Premier déploiement

```sh
# Installer le CLI Vercel
pnpm add -g vercel

# Depuis web/
cd web
vercel
# → Set up and deploy : oui
# → Lier au projet GitHub baloo (Vercel détecte Next.js automatiquement)
# → Build command : (auto, `next build`)
# → Output directory : (auto, `.next`)
# → Development command : (auto, `next dev`)
```

Vercel renvoie une URL de preview type `baloo-xyz.vercel.app`. Vérifier que le build passe.

### Configurer les variables d'environnement

Dashboard Vercel → Project → Settings → Environment Variables. Ajouter pour les trois environnements (Production, Preview, Development) :

| Variable | Valeur | Notes |
|---|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` | Secret unique par environnement |
| `EMAIL_SERVER` | `smtp://resend:re_xxx@smtp.resend.com:465` | Resend |
| `EMAIL_FROM` | `baloo@benomite.com` | Doit matcher un domaine vérifié Resend |
| `DB_URL` | `libsql://baloo-prod-<org>.turso.io` | URL Turso |
| `DB_AUTH_TOKEN` | (token Turso) | Marquer comme "Sensitive" |
| `BALOO_USER_EMAIL` | `<email-trésorier>` | Compat scripts CLI (cli-context) |
| `COMPTAWEB_USERNAME` | `<email-comptaweb>` | Login Comptaweb (Sirom). Marquer "Sensitive" |
| `COMPTAWEB_PASSWORD` | `<mot-de-passe>` | Idem. Marquer "Sensitive" |
| `COMPTAWEB_COOKIE` (fallback) | `PHPSESSID=...; ...` | Optionnel : cookie collé à la main si l'auth automatisée échoue. Expire en ~quelques heures |

### Provisionner Vercel Blob

Dashboard Vercel → Project → Storage → Create → Blob.
Vercel ajoute automatiquement la variable `BLOB_READ_WRITE_TOKEN` au projet. Pas d'action côté code (le service `lib/storage.ts` détecte la variable et bascule).

### Configurer le domaine `baloo.benomite.com`

1. Dashboard Vercel → Project → Settings → Domains → Add `baloo.benomite.com`.
2. Vercel affiche un CNAME à configurer chez ton registrar :
   ```
   baloo.benomite.com  CNAME  cname.vercel-dns.com
   ```
3. Attendre la vérification (TLS auto via Let's Encrypt, ~5 min).

### Re-déployer

```sh
vercel --prod
```

---

## 5. Configurer le MCP côté trésorier

Sur la machine locale du trésorier, mettre à jour `compta/.env` :

```sh
# Pointe vers la prod, plus le serveur web local
BALOO_API_URL=https://baloo.benomite.com
BALOO_API_TOKEN=<token-MCP>
```

Le `BALOO_API_TOKEN` se génère avec :

```sh
# Côté prod (via Vercel CLI ou en SSH-shell-équivalent)
vercel exec -- pnpm generate-token --name "MCP-trésorier"
# → bal_xxx... (à copier dans compta/.env)
```

Alternative : générer le token en local (pointant vers la prod) :

```sh
cd web
DB_URL=... DB_AUTH_TOKEN=... pnpm generate-token --name "MCP-trésorier"
```

---

## 6. Vérification post-déploiement

- [ ] `https://baloo.benomite.com/login` accessible, formulaire visible.
- [ ] Magic link reçu par email à l'adresse `BALOO_USER_EMAIL`.
- [ ] Connexion → dashboard `/`, données visibles.
- [ ] Upload d'un justif sur `/ecritures/<id>` → fichier visible (download).
- [ ] MCP local : `claude mcp list` → `baloo-compta` listé. `vue_ensemble` retourne les bonnes données.

---

## 7. Backups & monitoring

- **BDD** : Turso fait des backups quotidiens automatiques (free tier 9 GB rétention 30 jours).
- **Code** : `git push` est canonique.
- **Justificatifs** : Vercel Blob a un mécanisme de versioning (à confirmer côté Vercel).
- **Monitoring** : Vercel Analytics (free tier basique) suffit au MVP. Pour aller plus loin : Sentry (free tier 5K events/mois).

---

## 8. Coûts récurrents

| Service | Plan | Coût / mois |
|---|---|---|
| Vercel Hobby | Free (associatif, non commercial) | 0 € |
| Turso | Free tier (9 GB, 1 BDD) | 0 € |
| Resend | Free tier (3000 emails/mois) | 0 € |
| Vercel Blob | Free (~1 GB inclus) puis 0,15 $/GB | 0 € au MVP |
| Domaine `benomite.com` | (déjà payé pour autres usages) | 0 € marginal |
| **Total Y1** | | **~0 €** |

Sortie de secours si Vercel reclasse l'usage en commercial : bascule sur **Hetzner CX11 (~5 €/mois)** + Docker compose (Caddy + Next.js + LiteFS pour la BDD). La stack reste portable.

---

## 9. Limites assumées du déploiement actuel

Cette procédure couvre le cas **mono-trésorier d'un seul groupe SGDF**. Quelques limites à connaître :

- **Credentials Comptaweb partagés au niveau instance.** `COMPTAWEB_USERNAME` / `COMPTAWEB_PASSWORD` / `COMPTAWEB_COOKIE` vivent dans les env vars Vercel — un seul jeu pour toute l'instance. Tous les chefs d'unité connectés voient les mêmes données Comptaweb (celles du compte du trésorier). C'est OK tant qu'on est intra-groupe (ils n'ont de toute façon que leur scope unité côté Baloo). Dès qu'on ouvrira à plusieurs groupes (P3), ce design ne tient plus.
- **Évolution prévue P3** : table `user_credentials(user_id, service, value_enc)` + page `/settings/comptaweb` + chiffrement au repos. Placeholder dans [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git) (point 4) ; tâche listée dans [roadmap P3](roadmap.md#phase-3--multi-groupes-hébergé-mois-6--12-si-phase-2-concluante). ADR dédié à écrire au moment de l'implémentation pour le chiffrement (clé dans env Vercel ou KMS managé).
- **Cookie Comptaweb** : si tu utilises `COMPTAWEB_COOKIE` plutôt que username/password, il expire au bout de quelques heures et il faut le re-coller manuellement. L'auth automatisée (`COMPTAWEB_USERNAME` + `COMPTAWEB_PASSWORD`) fait un re-login transparent — préféré.
- **Pas de monitoring d'erreurs au MVP.** Vercel logs basiques uniquement. À surveiller : si Comptaweb change un endpoint ou son markup HTML, le scraping casse silencieusement (les routes `/api/comptaweb/*` renvoient des 502). Brancher Sentry quand le besoin se fait sentir.
