import { isShopItemId } from '../game/economy';
import { isMountId } from '../game/mounts';
import { isPetId } from '../game/pets';
import { isNpcAction, isNpcId } from '../game/npcs';
import { isSkillId } from '../game/skills';
import { isChainId } from '../game/story';
import { isTitleId, type TitleId } from '../game/titles';
import { MAX_INPUT_FRAMES, TOKEN_PATTERN } from './limits';
import type { ClientMessage, InputFrame } from './messages';
import { sanitizeChat, sanitizeName } from './sanitize';

export type ParseResult = { readonly ok: true; readonly msg: ClientMessage } | { readonly ok: false; readonly error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });
const okMsg = (msg: ClientMessage): ParseResult => ({ ok: true, msg });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

function parseFrame(v: unknown): InputFrame | null {
  if (!isRecord(v)) return null;
  const { seq, fwd, strafe, yaw, jump, swim } = v;
  if (!isId(seq) || seq > 2 ** 31) return null;
  if (!isFiniteIn(fwd, -1.01, 1.01) || !isFiniteIn(strafe, -1.01, 1.01) || !isFiniteIn(yaw, -1e4, 1e4)) return null;
  if (typeof jump !== 'boolean' || typeof swim !== 'boolean') return null;
  return { seq, fwd, strafe, yaw, jump, swim };
}

/**
 * Validates an untrusted, already JSON-decoded client message. Anything that is not
 * exactly one of the protocol shapes is rejected; strings come back sanitised.
 */
export function parseClientMessage(data: unknown): ParseResult {
  if (!isRecord(data) || typeof data.t !== 'string') return fail('Malformed message');
  switch (data.t) {
    case 'hello': {
      if (!Number.isInteger(data.v)) return fail('Missing protocol version');
      if (typeof data.token !== 'string' || !TOKEN_PATTERN.test(data.token)) return fail('Invalid token');
      if (typeof data.name !== 'string') return fail('Invalid name');
      const name = sanitizeName(data.name);
      if (!name) return fail('Names need 2–14 letters or numbers');
      return okMsg({ t: 'hello', v: data.v as number, token: data.token, name });
    }
    case 'input': {
      if (!Array.isArray(data.frames) || data.frames.length === 0 || data.frames.length > MAX_INPUT_FRAMES) return fail('Invalid input batch');
      const frames: InputFrame[] = [];
      for (const raw of data.frames) {
        const frame = parseFrame(raw);
        if (!frame) return fail('Invalid input frame');
        frames.push(frame);
      }
      return okMsg({ t: 'input', frames });
    }
    case 'skill': {
      if (!isSkillId(data.skill)) return fail('Unknown skill');
      if (data.target !== null && !isId(data.target)) return fail('Invalid target');
      return okMsg({ t: 'skill', skill: data.skill, target: data.target as number | null });
    }
    case 'npc': {
      if (!isNpcId(data.npc)) return fail('Unknown NPC');
      if (!isNpcAction(data.action)) return fail('Unknown action');
      const arg = data.arg ?? null;
      const story = data.action === 'accept' || data.action === 'turnIn' || data.action === 'talk';
      if (story && !isChainId(arg)) return fail('Unknown story');
      if (data.action === 'buy' && !isShopItemId(arg)) return fail('Unknown item');
      if (!story && data.action !== 'buy' && arg !== null) return fail('Unexpected argument');
      return okMsg({ t: 'npc', npc: data.npc, action: data.action, arg: arg as string | null });
    }
    case 'title': {
      if (data.title !== null && !isTitleId(data.title)) return fail('Unknown title');
      return okMsg({ t: 'title', title: data.title as TitleId | null });
    }
    case 'mount':
      if (typeof data.on !== 'boolean') return fail('Invalid mount request');
      return okMsg({ t: 'mount', on: data.on });
    case 'choose': {
      if (data.kind === 'mount' && (data.id === null || isMountId(data.id))) return okMsg({ t: 'choose', kind: 'mount', id: data.id });
      if (data.kind === 'pet' && (data.id === null || isPetId(data.id))) return okMsg({ t: 'choose', kind: 'pet', id: data.id });
      return fail('Unknown mount or pet');
    }
    case 'petName': {
      if (!isPetId(data.pet) || typeof data.name !== 'string' || data.name.length > 100) return fail('Invalid pet name');
      const name = sanitizeName(data.name);
      if (!name) return fail('Pet names need 2–14 letters or numbers');
      return okMsg({ t: 'petName', pet: data.pet, name });
    }
    case 'chat': {
      if (typeof data.text !== 'string' || data.text.length > 1000) return fail('Invalid chat message');
      const text = sanitizeChat(data.text);
      if (!text) return fail('Empty chat message');
      return okMsg({ t: 'chat', text });
    }
    case 'respawn':
      return okMsg({ t: 'respawn' });
    case 'ping':
      if (!isFiniteIn(data.at, 0, Number.MAX_SAFE_INTEGER)) return fail('Invalid ping');
      return okMsg({ t: 'ping', at: data.at });
    default:
      return fail('Unknown message type');
  }
}
