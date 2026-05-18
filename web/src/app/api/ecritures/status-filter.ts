// Helper extrait du route handler GET /api/ecritures pour pouvoir
// tester la logique de filtre status sans monter tout Next.
//
// Doctrine (pivot miroir strict + MCP-first) :
//
// - GET /api/ecritures sert le **miroir CW propre**. Par défaut :
//   `status='mirror'` uniquement.
// - L'opt-in `?includeDivergent=1` ajoute les `divergent` (utile pour
//   debug / audit des écarts détectés par la sync).
// - Les drafts / pending_cw / pending_sync vivent sur /inbox : on ne
//   les expose JAMAIS depuis ici.
// - Si un caller force `?status=draft` (ou autre), on lui rend
//   exactement ce qu'il demande (override total). Cas usage : MCP qui
//   veut lister les pending pour /inbox.

export interface ResolveStatusFilterInput {
  status?: string;
  includeDivergent?: string | boolean;
}

export function resolveStatusFilter(input: ResolveStatusFilterInput): string[] {
  if (input.status) return [input.status];
  const include = input.includeDivergent;
  const includesDivergent =
    include === true ||
    include === '1' ||
    include === 'true';
  return includesDivergent ? ['mirror', 'divergent'] : ['mirror'];
}
