// Traduit un échec de sync (message brut d'exception, ou run bloqué, ou
// erreur réseau client) en message parlant + action contextuelle.
//
// Cf. spec 2026-07-04-statut-sync-qui-parle-design.md. Le message brut vit
// déjà en base (`sync_runs.error_message`) et reste toujours atteignable
// (via `showRaw` en fallback + le journal /admin/errors). Ici on ne fait
// qu'expliquer ; on ne masque jamais l'info technique.
//
// Matching sur des sous-chaînes STABLES tirées des vrais `throw` :
//   - auth.ts        : « Aucun identifiant Comptaweb », « sont requis »
//   - http.ts        : ComptawebSessionExpiredError, « HTTP 5xx »
//   - auth-automated : « Keycloak », « MFA », « login », « redirection »
//   - scrapers       : « structure Comptaweb a peut-être changé », « introuvable »

const PARAMS_HREF = '/admin/parametres';

export type SyncErrorInput = {
  // 'failed'        : le run a écrit error_message.
  // 'running'       : run resté bloqué en cours (lock 60 s expiré) → interrompu.
  // 'error-client'  : fetch réseau côté navigateur a échoué.
  status: 'failed' | 'running' | 'error-client';
  errorMessage: string | null;
};

export type SyncErrorAction = { label: string; href: string };

export type SyncErrorInfo = {
  title: string;
  advice: string;
  action?: SyncErrorAction;
  // true → afficher aussi le message brut (cas fallback inconnu, message présent).
  showRaw: boolean;
};

const RECONNECT: SyncErrorAction = { label: 'Paramètres Comptaweb', href: PARAMS_HREF };

export function describeSyncError({ status, errorMessage }: SyncErrorInput): SyncErrorInfo {
  if (status === 'running') {
    return {
      title: 'Synchronisation interrompue',
      advice:
        "La dernière sync s'est arrêtée avant la fin (Comptaweb a mis trop de temps à répondre). Réessaie.",
      showRaw: false,
    };
  }

  if (status === 'error-client') {
    return {
      title: 'Connexion perdue',
      advice: 'Impossible de joindre Baloo. Vérifie ta connexion, puis réessaie.',
      showRaw: false,
    };
  }

  const raw = errorMessage ?? '';
  const m = raw.toLowerCase();

  // Identifiants absents (le plus spécifique côté config).
  if (m.includes('aucun identifiant comptaweb') || m.includes('sont requis')) {
    return {
      title: 'Comptaweb non configuré',
      advice: 'Renseigne tes identifiants Comptaweb pour pouvoir synchroniser.',
      action: RECONNECT,
      showRaw: false,
    };
  }

  // Session expirée.
  if (m.includes('sessionexpired') || m.includes('session expirée') || m.includes('session expiree')) {
    return {
      title: 'Session Comptaweb expirée',
      advice: 'Reconnecte-toi à Comptaweb pour relancer la sync.',
      action: { label: 'Reconnecter Comptaweb', href: PARAMS_HREF },
      showRaw: false,
    };
  }

  // Refus de connexion / auth (Keycloak, MFA, login, redirection).
  if (m.includes('keycloak') || m.includes('mfa') || m.includes('login') || m.includes('redirection')) {
    return {
      title: 'Connexion Comptaweb refusée',
      advice: 'Comptaweb a refusé la connexion. Vérifie tes identifiants.',
      action: RECONNECT,
      showRaw: false,
    };
  }

  // Structure de page changée (souci côté dev, pas une action user).
  if (
    m.includes('structure comptaweb') ||
    m.includes('layout') ||
    m.includes('introuvable') ||
    m.includes('a changé') ||
    m.includes('a change')
  ) {
    return {
      title: 'Comptaweb a changé',
      advice:
        'La page Comptaweb a changé de structure. Signale-le : une mise à jour de Baloo est nécessaire.',
      showRaw: false,
    };
  }

  // Erreur serveur Comptaweb (5xx).
  if (/http\s*5\d\d/.test(m) || m.includes('http 5')) {
    return {
      title: 'Comptaweb indisponible',
      advice: 'Comptaweb a renvoyé une erreur. Réessaie dans un moment.',
      showRaw: false,
    };
  }

  // Fallback : on n'a pas reconnu — on montre le message brut s'il existe.
  return {
    title: 'Échec de synchronisation',
    advice: "Une erreur inattendue s'est produite.",
    showRaw: raw.length > 0,
  };
}
