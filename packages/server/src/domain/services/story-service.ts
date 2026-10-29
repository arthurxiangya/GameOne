import {
  ITEM_DROP_CHANCE,
  chainById,
  chainStatus,
  currentStep,
  npcName,
  objectiveNeed,
  objectiveText,
  type ChainId,
  type NpcId,
  type RandomSource,
  type StoryChain,
} from '@lanternwood/shared';
import type { Achievement } from '../achievements';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import { fail, ok, type Result } from '../result';
import type { ProgressionService } from './progression-service';

/**
 * Runs the story scripts (shared/game/story.ts) for each hero: accepting steps, counting
 * objectives from achievements, completing steps and paying their rewards.
 */
export class StoryService {
  constructor(
    private readonly events: EventSink,
    private readonly progression: ProgressionService,
    private readonly rng: RandomSource,
  ) {}

  accept(player: Player, chainId: ChainId, npc: NpcId): Result {
    const chain = chainById(chainId);
    const cp = player.progress.story[chainId];
    const step = currentStep(chain, cp);
    const status = chainStatus(chain, cp, player.level);
    if (!step || status === 'done') return fail('That story is finished.');
    if (status === 'locked') return fail(`Come back at level ${chain.minLevel}.`);
    if (cp.state !== 'available') return fail('You are already on it.');
    if (npc !== chain.giver) return fail(`${npcName(chain.giver)} gives that task.`);
    cp.state = 'active';
    cp.progress = 0;
    player.touchProgress();
    this.events.player(player.id, { e: 'log', text: `Story: ${step.title}`, c: 'sys' });
    this.events.player(player.id, { e: 'toast', text: `${step.title}: ${objectiveText(step.objective, 0)}` });
    return ok();
  }

  turnIn(player: Player, chainId: ChainId, npc: NpcId): Result {
    const chain = chainById(chainId);
    const cp = player.progress.story[chainId];
    const step = currentStep(chain, cp);
    if (!step || cp.state !== 'ready') return fail('That task is not finished yet.');
    if (step.turnIn !== npc) return fail(step.turnIn ? `Take that to ${npcName(step.turnIn)}.` : 'That task is not finished yet.');
    this.complete(player, chain);
    return ok();
  }

  /** Completes a "talk to" step at the character it names. */
  talk(player: Player, chainId: ChainId, npc: NpcId): Result {
    const chain = chainById(chainId);
    const cp = player.progress.story[chainId];
    const step = currentStep(chain, cp);
    if (!step || cp.state !== 'active' || step.objective.kind !== 'talk' || step.objective.npc !== npc) {
      return fail('They have nothing to say about that.');
    }
    this.complete(player, chain);
    return ok();
  }

  onAchievement(player: Player, a: Achievement): void {
    if (a.kind === 'greet') return;
    for (const [id, cp] of Object.entries(player.progress.story)) {
      if (cp.state !== 'active') continue;
      const chain = chainById(id as ChainId);
      const step = currentStep(chain, cp);
      if (!step) continue;
      const o = step.objective;
      if (a.kind === 'visit') {
        if (o.kind === 'visit' && o.place === a.place) this.objectiveMet(player, chain);
        continue;
      }
      if ((o.kind !== 'defeat' && o.kind !== 'collect') || o.monster !== a.monster) continue;
      if (o.kind === 'collect') {
        if (this.rng.next() >= ITEM_DROP_CHANCE) continue;
        this.events.player(player.id, { e: 'log', text: `Looted: ${o.item}`, c: 'loot' });
      }
      cp.progress = Math.min(objectiveNeed(o), cp.progress + 1);
      player.touchProgress();
      if (cp.progress >= objectiveNeed(o)) this.objectiveMet(player, chain);
      else this.events.player(player.id, { e: 'toast', text: objectiveText(o, cp.progress) });
    }
  }

  private objectiveMet(player: Player, chain: StoryChain): void {
    const cp = player.progress.story[chain.id];
    const step = currentStep(chain, cp);
    if (!step) return;
    if (step.turnIn === null) {
      this.complete(player, chain);
      return;
    }
    cp.state = 'ready';
    player.touchProgress();
    this.events.player(player.id, { e: 'toast', text: `${step.title} done! Return to ${npcName(step.turnIn)}.` });
    this.events.player(player.id, { e: 'log', text: `Objective complete: ${step.title}`, c: 'sys' });
  }

  private complete(player: Player, chain: StoryChain): void {
    const cp = player.progress.story[chain.id];
    const step = currentStep(chain, cp);
    if (!step) return;
    const p = player.progress;
    const r = step.reward;
    this.events.player(player.id, { e: 'story', title: step.title, text: step.done });
    if (r.gold > 0) this.progression.grantGold(player, r.gold);
    if (r.tonics) p.tonics += r.tonics;
    const paid = [r.gold > 0 ? `+${r.gold} gold` : '', r.tonics ? `+${r.tonics} tonic${r.tonics > 1 ? 's' : ''}` : '', r.marks ? `+${r.marks} Ember Mark${r.marks > 1 ? 's' : ''}` : '']
      .filter(Boolean)
      .join(' · ');
    this.events.player(player.id, { e: 'log', text: `Completed: ${step.title}${paid ? ` · ${paid}` : ''}`, c: 'sys' });
    if (r.marks) this.progression.grantMarks(player, r.marks);
    if (r.title) this.progression.grantTitle(player, r.title);
    if (r.mount) this.progression.grantMount(player, r.mount);
    this.progression.grantXp(player, r.xp);

    cp.step += 1;
    cp.progress = 0;
    const next = currentStep(chain, cp);
    cp.state = next?.accept ? 'available' : 'active';
    player.touchProgress();
    if (!next) {
      this.events.player(player.id, { e: 'toast', text: `Story complete: ${chain.title}` });
    } else if (next.accept) {
      this.events.player(player.id, { e: 'toast', text: `${npcName(chain.giver)} has more for you.` });
    } else {
      this.events.player(player.id, { e: 'toast', text: `Next: ${objectiveText(next.objective, 0)}` });
    }
  }
}
