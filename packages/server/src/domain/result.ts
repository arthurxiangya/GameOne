/** Outcome of a player action. Failures carry a message that is safe to show the player. */
export type Result<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const OK: Result<void> = { ok: true, value: undefined };

export const ok = (): Result<void> => OK;

export const okWith = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (error: string): Result<never> => ({ ok: false, error });
