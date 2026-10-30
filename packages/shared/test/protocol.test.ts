import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_INPUT_FRAMES, PROTOCOL_VERSION, decodeJson, decodeServerMessage, parseClientMessage, sanitizeChat, sanitizeName } from '../src/index';

const token = 'a'.repeat(32);
const frame = { seq: 1, fwd: 1, strafe: 0, yaw: 0.5, jump: false, swim: false };

describe('parseClientMessage', () => {
  it('accepts a hello with a class and cleans the name', () => {
    const r = parseClientMessage({ t: 'hello', v: PROTOCOL_VERSION, token, name: '  Sir   Lance\u0007 ', cls: 'warden' });
    assert.ok(r.ok);
    assert.deepEqual(r.msg, { t: 'hello', v: PROTOCOL_VERSION, token, name: 'Sir Lance', cls: 'warden' });
  });

  it('rejects malformed or hostile hellos', () => {
    assert.equal(parseClientMessage({ t: 'hello', v: 1, token: 'short', name: 'Ok' }).ok, false);
    assert.equal(parseClientMessage({ t: 'hello', v: 1, token, name: '!' }).ok, false);
    assert.equal(parseClientMessage({ t: 'hello', v: '1', token, name: 'Okay', cls: 'warden' }).ok, false);
    assert.equal(parseClientMessage({ t: 'hello', v: 1, token, name: 'Okay' }).ok, false, 'a class is required');
    assert.equal(parseClientMessage({ t: 'hello', v: 1, token, name: 'Okay', cls: 'paladin' }).ok, false);
  });

  it('validates every input frame', () => {
    assert.ok(parseClientMessage({ t: 'input', frames: [frame] }).ok);
    assert.equal(parseClientMessage({ t: 'input', frames: [{ ...frame, fwd: 5 }] }).ok, false);
    assert.equal(parseClientMessage({ t: 'input', frames: [{ ...frame, seq: -1 }] }).ok, false);
    assert.equal(parseClientMessage({ t: 'input', frames: [{ ...frame, jump: 'yes' }] }).ok, false);
    assert.equal(parseClientMessage({ t: 'input', frames: [] }).ok, false);
    const tooMany = Array.from({ length: MAX_INPUT_FRAMES + 1 }, (_, i) => ({ ...frame, seq: i + 1 }));
    assert.equal(parseClientMessage({ t: 'input', frames: tooMany }).ok, false);
  });

  it('checks skills, targets and NPC actions against the game data', () => {
    assert.ok(parseClientMessage({ t: 'skill', skill: 'aimedShot', target: 12 }).ok);
    assert.ok(parseClientMessage({ t: 'skill', skill: 'slash', target: null }).ok);
    assert.ok(parseClientMessage({ t: 'skill', skill: 'tonic', target: null }).ok);
    assert.equal(parseClientMessage({ t: 'skill', skill: 'strike', target: null }).ok, false, 'the old shared kit is gone');
    assert.equal(parseClientMessage({ t: 'skill', skill: 'aimedShot', target: 1.5 }).ok, false);
    assert.ok(parseClientMessage({ t: 'npc', npc: 'oda', action: 'buyTonic' }).ok);
    assert.equal(parseClientMessage({ t: 'npc', npc: 'nobody', action: 'buyTonic' }).ok, false);
  });

  it('accepts a class change only with a spec of that class', () => {
    assert.deepEqual(parseClientMessage({ t: 'class', cls: 'ranger', spec: 'trapper' }), { ok: true, msg: { t: 'class', cls: 'ranger', spec: 'trapper' } });
    assert.ok(parseClientMessage({ t: 'class', cls: 'ranger', spec: null }).ok);
    assert.equal(parseClientMessage({ t: 'class', cls: 'ranger', spec: 'bulwark' }).ok, false);
    assert.equal(parseClientMessage({ t: 'class', cls: 'rogue', spec: null }).ok, false);
    assert.equal(parseClientMessage({ t: 'class', cls: 'ranger' }).ok, false);
  });

  it('requires a known story for story actions and a known item for trades', () => {
    assert.ok(parseClientMessage({ t: 'npc', npc: 'tamsin', action: 'accept', arg: 'bell' }).ok);
    assert.equal(parseClientMessage({ t: 'npc', npc: 'tamsin', action: 'accept', arg: 'nope' }).ok, false);
    assert.equal(parseClientMessage({ t: 'npc', npc: 'tamsin', action: 'talk' }).ok, false);
    assert.ok(parseClientMessage({ t: 'npc', npc: 'oda', action: 'buy', arg: 'tonicSatchel' }).ok);
    assert.equal(parseClientMessage({ t: 'npc', npc: 'oda', action: 'buy', arg: 'castle' }).ok, false);
    assert.equal(parseClientMessage({ t: 'npc', npc: 'oda', action: 'sharpen', arg: 'bell' }).ok, false);
    assert.deepEqual(parseClientMessage({ t: 'npc', npc: 'rook', action: 'greet' }), { ok: true, msg: { t: 'npc', npc: 'rook', action: 'greet', arg: null } });
  });

  it('checks mount and pet requests', () => {
    assert.ok(parseClientMessage({ t: 'mount', on: true }).ok);
    assert.equal(parseClientMessage({ t: 'mount', on: 'yes' }).ok, false);
    assert.ok(parseClientMessage({ t: 'choose', kind: 'mount', id: 'elk' }).ok);
    assert.ok(parseClientMessage({ t: 'choose', kind: 'pet', id: null }).ok);
    assert.equal(parseClientMessage({ t: 'choose', kind: 'pet', id: 'elk' }).ok, false);
    assert.equal(parseClientMessage({ t: 'choose', kind: 'dragon', id: null }).ok, false);
    assert.deepEqual(parseClientMessage({ t: 'petName', pet: 'fox', name: '  Kit<b> ' }), { ok: true, msg: { t: 'petName', pet: 'fox', name: 'Kitb' } });
    assert.equal(parseClientMessage({ t: 'petName', pet: 'fox', name: '!' }).ok, false);
  });

  it('accepts only earned-title ids or null', () => {
    assert.ok(parseClientMessage({ t: 'title', title: 'bellfinder' }).ok);
    assert.ok(parseClientMessage({ t: 'title', title: null }).ok);
    assert.equal(parseClientMessage({ t: 'title', title: 'king' }).ok, false);
  });

  it('rejects unknown types and non-objects', () => {
    assert.equal(parseClientMessage({ t: 'teleport' }).ok, false);
    assert.equal(parseClientMessage(null).ok, false);
    assert.equal(parseClientMessage([1, 2]).ok, false);
    assert.equal(parseClientMessage('hello').ok, false);
  });
});

describe('sanitizers and codec', () => {
  it('strips control characters and collapses whitespace in chat', () => {
    assert.equal(sanitizeChat('  hi\u0000 \n there  '), 'hi there');
    assert.equal(sanitizeChat(' ​ '), null);
    assert.equal(sanitizeChat('x'.repeat(500))?.length, 140);
  });

  it('keeps letters from any language in names', () => {
    assert.equal(sanitizeName('Zoë 星'), 'Zoë 星');
    assert.equal(sanitizeName('<script>'), 'script');
  });

  it('refuses oversized or broken JSON', () => {
    assert.equal(decodeJson('{"t":"ping"', 100), undefined);
    assert.equal(decodeJson('x'.repeat(200), 100), undefined);
    assert.deepEqual(decodeJson('{"t":"ping","at":1}', 100), { t: 'ping', at: 1 });
  });

  it('only accepts known server message types', () => {
    assert.equal(decodeServerMessage('{"t":"surprise"}'), null);
    assert.equal(decodeServerMessage('{"t":"system","text":"hi"}')?.t, 'system');
  });
});
