import { createHash } from 'crypto';

// PKCE (RFC 7636) avec methode S256 uniquement (plain non supporte).
// Le verifier est genere cote client (Claude Desktop) ; le challenge =
// base64url(SHA-256(verifier)) est envoye au /authorize. Lors du POST
// /token, le client envoie le verifier ; le serveur recalcule le
// challenge et compare.

export function computeS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function verifyS256Pkce(verifier: string, expectedChallenge: string): boolean {
  return computeS256Challenge(verifier) === expectedChallenge;
}
