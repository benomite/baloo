import { createHash, randomBytes } from 'crypto';

// Tokens OAuth :
//   - Authorization code (boc_*) : ephemere (~2 min), single-use
//   - Access token (boa_*) : 30 jours
// Tous deux : 32 bytes aleatoires en base64url. Stockage en BDD =
// SHA-256 hex (cf. doctrine api_tokens existante).

const CODE_PREFIX = 'boc_';
const ACCESS_TOKEN_PREFIX = 'boa_';

export interface GeneratedToken {
  plain: string;
  hash: string;
}

function genToken(prefix: string): GeneratedToken {
  const plain = prefix + randomBytes(32).toString('base64url');
  return { plain, hash: hashOauthToken(plain) };
}

export function generateAuthorizationCode(): GeneratedToken {
  return genToken(CODE_PREFIX);
}

export function generateAccessToken(): GeneratedToken {
  return genToken(ACCESS_TOKEN_PREFIX);
}

export function hashOauthToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
