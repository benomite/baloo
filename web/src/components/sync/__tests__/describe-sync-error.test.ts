// Traduction d'un échec de sync en message parlant + action.
// Cf. spec 2026-07-04-statut-sync-qui-parle-design.md (§B).
//
// Matching sur des sous-chaînes STABLES tirées des vrais `throw` du code
// Comptaweb (auth.ts, http.ts, ecritures-bancaires.ts…). Ordre : du plus
// spécifique au plus générique, premier match gagne, fallback couvre tout.

import { describe, it, expect } from 'vitest';
import { describeSyncError } from '../describe-sync-error';

describe('describeSyncError', () => {
  it('run bloqué (status running, lock expiré) → « interrompue », pas d\'action', () => {
    const info = describeSyncError({ status: 'running', errorMessage: null });
    expect(info.title).toMatch(/interrompue/i);
    expect(info.advice).toMatch(/avant la fin|trop de temps/i);
    expect(info.action).toBeUndefined();
    expect(info.showRaw).toBe(false);
  });

  it('erreur réseau côté client → « Connexion perdue »', () => {
    const info = describeSyncError({ status: 'error-client', errorMessage: null });
    expect(info.title).toMatch(/connexion perdue/i);
    expect(info.action).toBeUndefined();
  });

  it('« Aucun identifiant Comptaweb » → non configuré + action paramètres', () => {
    const info = describeSyncError({
      status: 'failed',
      errorMessage:
        'Aucun identifiant Comptaweb. Configure-les dans /admin/parametres (ou COMPTAWEB_USERNAME + COMPTAWEB_PASSWORD).',
    });
    expect(info.title).toMatch(/non configuré/i);
    expect(info.action?.href).toBe('/admin/parametres');
    expect(info.showRaw).toBe(false);
  });

  it('« COMPTAWEB_USERNAME ... sont requis » → non configuré + action', () => {
    const info = describeSyncError({
      status: 'failed',
      errorMessage: "COMPTAWEB_USERNAME et COMPTAWEB_PASSWORD sont requis pour l'auth automatisée.",
    });
    expect(info.title).toMatch(/non configuré/i);
    expect(info.action?.href).toBe('/admin/parametres');
  });

  it('ComptawebSessionExpiredError → session expirée + reconnexion', () => {
    const info = describeSyncError({
      status: 'failed',
      errorMessage: 'ComptawebSessionExpiredError: session expirée',
    });
    expect(info.title).toMatch(/session.*expirée/i);
    expect(info.action?.href).toBe('/admin/parametres');
  });

  it('indice Keycloak/MFA → connexion refusée + action paramètres', () => {
    const info = describeSyncError({
      status: 'failed',
      errorMessage: 'Form #kc-form-login introuvable — MFA activé ou layout Keycloak changé.',
    });
    expect(info.title).toMatch(/refusée/i);
    expect(info.action?.href).toBe('/admin/parametres');
  });

  it('« structure Comptaweb a peut-être changé » → a changé, pas d\'action, pas de showRaw', () => {
    const info = describeSyncError({
      status: 'failed',
      errorMessage:
        'Formulaire #form_rapprochement introuvable dans la page — structure Comptaweb a peut-être changé.',
    });
    expect(info.title).toMatch(/a changé/i);
    expect(info.action).toBeUndefined();
    expect(info.showRaw).toBe(false);
  });

  it('« HTTP 500 » → Comptaweb indisponible', () => {
    const info = describeSyncError({
      status: 'failed',
      errorMessage: 'GET /recettedepense a échoué : HTTP 500',
    });
    expect(info.title).toMatch(/indisponible/i);
    expect(info.action).toBeUndefined();
  });

  it('message inconnu → fallback, showRaw=true, message brut préservé', () => {
    const info = describeSyncError({
      status: 'failed',
      errorMessage: 'Quelque chose de totalement inattendu',
    });
    expect(info.title).toMatch(/échec/i);
    expect(info.showRaw).toBe(true);
  });

  it('errorMessage null + status failed → fallback propre, pas de crash', () => {
    const info = describeSyncError({ status: 'failed', errorMessage: null });
    expect(info.title).toBeTruthy();
    expect(info.advice).toBeTruthy();
    // Rien à afficher en brut si null.
    expect(info.showRaw).toBe(false);
  });
});
