import { CHAT_MAX_LENGTH, NAME_MAX_LENGTH, NAME_MIN_LENGTH } from './limits';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;
const NAME_DISALLOWED = /[^\p{L}\p{N} _'.-]/gu;

/** Normalises a hero name, or returns null if nothing usable is left. */
export function sanitizeName(raw: string): string | null {
  const name = raw.replace(CONTROL_CHARS, '').replace(NAME_DISALLOWED, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH).trim();
  return name.length >= NAME_MIN_LENGTH ? name : null;
}

/** Normalises a chat line, or returns null if it is empty. */
export function sanitizeChat(raw: string): string | null {
  const text = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
  return text.length > 0 ? text : null;
}
