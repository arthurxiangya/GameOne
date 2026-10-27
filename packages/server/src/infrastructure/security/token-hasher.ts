import { createHash } from 'node:crypto';
import type { TokenHasher } from '../../application/ports';

/**
 * Guest tokens are secrets held by the browser. Only their salted hash is used as the
 * account id, so save files and logs never contain anything that can sign in.
 */
export const createTokenHasher =
  (salt: string): TokenHasher =>
  (token) =>
    createHash('sha256').update(`${salt}:${token}`).digest('hex').slice(0, 32);
