import {
  CHAINS,
  MAX_EGGS,
  MAX_WEAPON_TIER,
  SHOP_ITEMS,
  SHOP_ITEM_IDS,
  TITLES,
  TONIC_PRICE,
  bountyCount,
  bountyFromId,
  bountyGold,
  chainStatus,
  currentStep,
  npcName,
  objectiveText,
  priceText,
  sharpenCost,
  type NpcAction,
  type NpcDef,
  type NpcId,
  type PlayerProgress,
  type ShopItemId,
  type StepReward,
  type StoryChain,
} from '@lanternwood/shared';

/**
 * What a hero can talk about with a character, worked out from shared game data and the
 * hero's progress. Pure, so the dialog view only renders and the rules are testable.
 */

export type Paragraph = string | { readonly dim: string };

export interface TopicAction {
  readonly label: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  /** Sent to the server when chosen. */
  readonly send?: { readonly action: NpcAction; readonly arg: string | null };
  /** Close the dialog after choosing (default true unless the action keeps a shop open). */
  readonly close?: boolean;
}

export interface Topic {
  readonly key: string;
  /** Label in the list of topics. */
  readonly label: string;
  /** `!` for something new, `?` for something to hand in or a story beat waiting here. */
  readonly mark: '!' | '?' | '';
  readonly title: string;
  readonly paragraphs: readonly Paragraph[];
  readonly actions: readonly TopicAction[];
}

export const rewardText = (r: StepReward): string =>
  [
    r.xp ? `${r.xp} XP` : '',
    r.gold ? `${r.gold} gold` : '',
    r.tonics ? `${r.tonics} tonic${r.tonics > 1 ? 's' : ''}` : '',
    r.marks ? `${r.marks} Ember Mark${r.marks > 1 ? 's' : ''}` : '',
    r.title ? `the title ${TITLES[r.title].name}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

const farewell: TopicAction = { label: 'Farewell' };

function storyTopic(chain: StoryChain, npc: NpcId, p: PlayerProgress): Topic | null {
  const cp = p.story[chain.id];
  const status = chainStatus(chain, cp, p.level);
  const step = currentStep(chain, cp);
  const key = `story:${chain.id}`;
  if (!step) return null;
  const reward = `Reward: ${rewardText(step.reward)}.`;
  if (status === 'locked') {
    if (npc !== chain.giver) return null;
    return {
      key, label: `${chain.title} (level ${chain.minLevel})`, mark: '', title: chain.title,
      paragraphs: [`I may need your help one day. Come back when you are level ${chain.minLevel}.`],
      actions: [farewell],
    };
  }
  if (status === 'available' && npc === chain.giver) {
    return {
      key, label: step.title, mark: '!', title: step.title,
      paragraphs: [step.offer, { dim: `${reward}${step.recommended ? ` Recommended ${step.recommended}.` : ''}` }],
      actions: [{ label: 'Accept', primary: true, send: { action: 'accept', arg: chain.id } }, { label: 'Not yet' }],
    };
  }
  if (status === 'ready' && step.turnIn === npc) {
    return {
      key, label: step.title, mark: '?', title: step.title,
      paragraphs: [step.done, { dim: reward }],
      actions: [{ label: 'Claim reward', primary: true, send: { action: 'turnIn', arg: chain.id } }],
    };
  }
  if (status === 'active' && step.objective.kind === 'talk' && step.objective.npc === npc) {
    return {
      key, label: step.title, mark: '?', title: step.title,
      paragraphs: [step.done, { dim: reward }],
      actions: [{ label: 'Continue', primary: true, send: { action: 'talk', arg: chain.id } }],
    };
  }
  if ((status === 'active' || status === 'ready') && (npc === chain.giver || npc === step.turnIn)) {
    const where = status === 'ready' && step.turnIn ? `Bring it to ${npcName(step.turnIn)}.` : step.where;
    return {
      key, label: step.title, mark: '', title: step.title,
      paragraphs: [step.remind, { dim: `${objectiveText(step.objective, cp.progress)} · ${where}` }],
      actions: [{ label: 'On my way', primary: true }],
    };
  }
  return null;
}

function forgeTopic(p: PlayerProgress): Topic {
  const cost = sharpenCost(p.weapon);
  const maxed = p.weapon >= MAX_WEAPON_TIER;
  return {
    key: 'forge', label: 'The forge', mark: '', title: 'Oda’s Forge',
    paragraphs: [`Steel and tonics, fair prices. Your blade is at +${p.weapon * 4} attack. You carry ${p.gold} gold.`],
    actions: [
      { label: `Buy a healing tonic · ${TONIC_PRICE} gold`, primary: true, disabled: p.gold < TONIC_PRICE, send: { action: 'buyTonic', arg: null }, close: false },
      maxed
        ? { label: 'Your blade is as sharp as it gets', disabled: true, close: false }
        : { label: `Sharpen blade (+4 attack) · ${cost} gold`, disabled: p.gold < cost, send: { action: 'sharpen', arg: null }, close: false },
      { label: 'Leave' },
    ],
  };
}

/** Why a hero cannot buy an item right now (beyond the price), or null. */
function shopBlock(p: PlayerProgress, id: ShopItemId): string | null {
  const item = SHOP_ITEMS[id];
  const g = item.grant;
  if (g.kind === 'title' && p.titles.includes(g.title)) return 'yours';
  if (g.kind === 'mount' && p.mounts.includes(g.mount)) return 'yours';
  if (g.kind === 'egg') {
    if (p.pets.some((x) => x.id === g.pet)) return 'yours';
    if (p.eggs.some((e) => e.pet === g.pet)) return 'in your bag';
    if (p.eggs.length >= MAX_EGGS) return 'bag full';
  }
  if (p.level < item.minLevel) return `level ${item.minLevel}`;
  return null;
}

function marksTopic(p: PlayerProgress): Topic {
  return {
    key: 'marks', label: 'Mounts, eggs and Mark trades', mark: '', title: 'Oda’s trades',
    paragraphs: [`A mount for the road, an egg to raise, or a trade for Ember Marks. You have ${p.gold} gold and ${p.marks} Ember Mark${p.marks === 1 ? '' : 's'}.`],
    actions: [
      ...SHOP_ITEM_IDS.map((id): TopicAction => {
        const item = SHOP_ITEMS[id];
        const blocked = shopBlock(p, id);
        return {
          label: `${item.name} · ${blocked ?? priceText(item)}`,
          disabled: blocked !== null || p.gold < item.gold || p.marks < item.marks,
          send: { action: 'buy', arg: id },
          close: false,
        };
      }),
      { label: 'Leave' },
    ],
  };
}

/** Today's board as lines of text, shared by Captain Rook and the journal. */
export function bountyLines(p: PlayerProgress): { title: string; text: string; status: string; done: boolean }[] {
  const b = p.bounties;
  return b.ids.flatMap((id, i) => {
    const def = bountyFromId(id);
    if (!def) return [];
    const done = b.done[i] ?? false;
    const count = bountyCount(def, b.counts[i] ?? 0, b.seen);
    return [{ title: def.title, text: def.text, status: done ? 'Done' : `${count} / ${def.need}`, done }];
  });
}

/** Time until the board changes at 00:00 UTC, like "5h 12m". */
export function untilNewBounties(nowMs: number): string {
  const minutes = Math.ceil((86_400_000 - (nowMs % 86_400_000)) / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function bountyTopic(p: PlayerProgress, nowMs: number): Topic {
  const lines = bountyLines(p);
  return {
    key: 'bounties', label: 'Today’s bounties', mark: '', title: 'Today’s bounties',
    paragraphs: [
      ...lines.map((l) => `${l.done ? '✓ ' : ''}${l.title}: ${l.text} (${l.status})`),
      { dim: `Each pays ${bountyGold(p.level)} gold, XP and an Ember Mark; all three add 2 more Marks. New bounties in ${untilNewBounties(nowMs)}.` },
    ],
    actions: [{ label: 'Good hunting', primary: true }],
  };
}

/** Everything `npc` can talk about right now, most important first. */
export function npcTopics(npc: NpcDef, p: PlayerProgress, nowMs: number): Topic[] {
  const story = CHAINS.map((c) => storyTopic(c, npc.id, p)).filter((t): t is Topic => t !== null);
  const rank = (t: Topic): number => (t.mark === '?' ? 0 : t.mark === '!' ? 1 : 2);
  story.sort((a, b) => rank(a) - rank(b));
  const topics = [...story];
  if (npc.services.includes('bounties')) topics.push(bountyTopic(p, nowMs));
  if (npc.services.includes('forge')) topics.push(forgeTopic(p));
  if (npc.services.includes('marks')) topics.push(marksTopic(p));
  if (topics.length === 0) {
    topics.push({ key: 'idle', label: 'Chat', mark: '', title: npc.name, paragraphs: [npc.idle], actions: [farewell] });
  }
  return topics;
}

/** The mark to float above a character: something to hand in beats something new. */
export function npcMark(npc: NpcDef, p: PlayerProgress): '!' | '?' | '' {
  let mark: '!' | '?' | '' = '';
  for (const chain of CHAINS) {
    const topic = storyTopic(chain, npc.id, p);
    if (topic?.mark === '?') return '?';
    if (topic?.mark === '!') mark = '!';
  }
  return mark;
}
