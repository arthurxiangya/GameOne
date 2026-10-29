import {
  CHAINS,
  chainById,
  chainStatus,
  currentStep,
  findNpc,
  npcName,
  objectiveText,
  type ChainId,
  type GeneratedWorld,
  type PlayerProgress,
} from '@lanternwood/shared';

/** What the quest tracker under the minimap shows. */
export interface TrackerInfo {
  readonly kind: string;
  readonly title: string;
  readonly objective: string;
  readonly where: string;
}

/**
 * The chain worth tracking when the hero has not picked one: something to hand in first, then
 * anything under way, then a new story on offer, in story order.
 */
export function defaultTracked(p: PlayerProgress): ChainId | null {
  const statusOf = (id: ChainId) => chainStatus(chainById(id), p.story[id], p.level);
  for (const wanted of ['ready', 'active', 'available'] as const) {
    const found = CHAINS.find((c) => statusOf(c.id) === wanted);
    if (found) return found.id;
  }
  return null;
}

/** Whether a tracked chain is still worth showing. */
export function stillTrackable(p: PlayerProgress, id: ChainId): boolean {
  const status = chainStatus(chainById(id), p.story[id], p.level);
  return status !== 'done' && status !== 'locked';
}

export function trackerInfo(p: PlayerProgress, id: ChainId | null): TrackerInfo {
  if (id === null) {
    return { kind: 'Realm', title: 'Every story told', objective: 'Daily bounties: talk to Captain Rook', where: 'Open the journal with J' };
  }
  const chain = chainById(id);
  const cp = p.story[id];
  const step = currentStep(chain, cp);
  const status = chainStatus(chain, cp, p.level);
  if (!step) return trackerInfo(p, null);
  if (status === 'available') {
    return { kind: 'New story', title: chain.title, objective: `Talk to ${npcName(chain.giver)}`, where: 'Look for the gold ! on your map' };
  }
  if (status === 'ready' && step.turnIn) {
    return { kind: 'Turn in', title: step.title, objective: `Return to ${npcName(step.turnIn)}`, where: 'The gold marker on your map' };
  }
  return { kind: chain.title, title: step.title, objective: objectiveText(step.objective, cp.progress), where: step.where };
}

export interface Spot {
  readonly x: number;
  readonly z: number;
}

/**
 * Where the tracked step wants the hero to go: a character, a landmark, or the nearest monster
 * of the right kind (in view if any, otherwise its nearest spawn point, which the client knows
 * because the world is generated from the seed).
 */
export function objectiveSpot(
  p: PlayerProgress,
  id: ChainId | null,
  generated: GeneratedWorld,
  liveMonsters: readonly { readonly type: string; readonly x: number; readonly z: number }[],
  from: Spot,
): Spot | null {
  if (id === null) return null;
  const chain = chainById(id);
  const cp = p.story[id];
  const step = currentStep(chain, cp);
  const status = chainStatus(chain, cp, p.level);
  if (!step || status === 'done' || status === 'locked') return null;
  const npcSpot = (npc: Parameters<typeof findNpc>[1]): Spot | null => findNpc(generated.npcs, npc) ?? null;
  if (status === 'available') return npcSpot(chain.giver);
  if (status === 'ready') return step.turnIn ? npcSpot(step.turnIn) : null;
  const o = step.objective;
  if (o.kind === 'talk') return npcSpot(o.npc);
  if (o.kind === 'visit') return generated.landmarks.find((l) => l.id === o.place) ?? null;
  let candidates: Spot[] = liveMonsters.filter((m) => m.type === o.monster);
  if (candidates.length === 0) candidates = generated.monsterSpawns.filter((s) => s.type === o.monster);
  let best: Spot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const d = Math.hypot(c.x - from.x, c.z - from.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}
