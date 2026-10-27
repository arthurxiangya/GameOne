const TOKEN_KEY = 'lanternwood.token';
const NAME_KEY = 'lanternwood.name';

export interface Identity {
  readonly token: string;
  readonly name: string;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode). The hero then lasts for this tab only.
  }
}

/**
 * Guest identity: a random secret kept in this browser. The server only ever stores its hash,
 * so clearing site data starts a new hero.
 */
export function loadIdentity(): Identity {
  let token = read(TOKEN_KEY);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = randomToken();
    write(TOKEN_KEY, token);
  }
  return { token, name: read(NAME_KEY) ?? '' };
}

export const rememberName = (name: string): void => write(NAME_KEY, name);
