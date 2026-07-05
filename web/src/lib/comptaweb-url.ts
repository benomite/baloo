// URL publique d'une écriture dans Comptaweb (page d'affichage). Client-safe :
// pas d'accès env/serveur. L'instance Comptaweb (Sirom) est commune à tous les
// groupes SGDF. On pointe la page `/afficher` (fiable) et non `/modifier` qui
// renvoie une 500 sur certaines écritures (cf. AGENTS.md) — depuis l'affichage,
// le bouton « modifier » de Comptaweb reste accessible.

const COMPTAWEB_BASE_URL = 'https://sgdf.production.sirom.net';

export function comptawebEcritureUrl(comptawebEcritureId: number): string {
  return `${COMPTAWEB_BASE_URL}/recettedepense/${comptawebEcritureId}/afficher`;
}
