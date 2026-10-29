import { LANDMARK_NAMES, type LandmarkId } from '../world/landmarks';
import { MONSTERS, type MonsterType } from './monsters';
import type { MountId } from './mounts';
import { npcName, type NpcId } from './npcs';
import type { TitleId } from './titles';

/**
 * The story scripts. A chain is an ordered list of steps; each step has one objective, who
 * takes it back, its lines and its reward. The engine that runs them is StoryService on the
 * server; the client reads the same data to show dialog, the journal and map markers.
 *
 * Saved heroes store each chain's step index, so steps may only ever be APPENDED to a chain,
 * never inserted, removed or reordered. A hero who finished a chain picks up a new last step
 * automatically.
 */

export type ChainId = 'main' | 'bell' | 'thief' | 'rift';

export type Objective =
  | { readonly kind: 'defeat'; readonly monster: MonsterType; readonly count: number }
  | { readonly kind: 'collect'; readonly monster: MonsterType; readonly count: number; readonly item: string }
  | { readonly kind: 'visit'; readonly place: LandmarkId }
  | { readonly kind: 'talk'; readonly npc: NpcId };

export interface StepReward {
  readonly xp: number;
  readonly gold: number;
  readonly tonics?: number;
  readonly marks?: number;
  readonly title?: TitleId;
  readonly mount?: MountId;
}

export interface StoryStep {
  readonly title: string;
  readonly objective: Objective;
  /**
   * True: the hero accepts this step from the chain's giver before it starts. False: it starts
   * the moment the previous step ends, so the story keeps moving.
   */
  readonly accept: boolean;
  /**
   * Who takes the step back once its objective is met. Null completes it on the spot. A talk
   * step always completes at the character it asks you to talk to.
   */
  readonly turnIn: NpcId | null;
  readonly where: string;
  readonly recommended?: string;
  /** Said when the step is offered, or when it starts. */
  readonly offer: string;
  /** Said while the step is under way. */
  readonly remind: string;
  /** Said when the step is completed. */
  readonly done: string;
  readonly reward: StepReward;
}

export interface StoryChain {
  readonly id: ChainId;
  readonly title: string;
  readonly giver: NpcId;
  readonly minLevel: number;
  readonly steps: readonly StoryStep[];
}

/** Collect objectives drop their item with this chance per kill. */
export const ITEM_DROP_CHANCE = 0.72;

const MAIN: StoryChain = {
  id: 'main',
  title: 'The Frost Heart',
  giver: 'maren',
  minLevel: 1,
  steps: [
    {
      title: 'Puffcap Trouble', objective: { kind: 'defeat', monster: 'puffcap', count: 6 }, accept: true, turnIn: 'maren',
      where: 'Sunmeadow · the green ring around town', recommended: 'Level 1–3', reward: { xp: 90, gold: 25, tonics: 2 },
      offer: 'Puffcaps have been nibbling the lantern oil again. Clear six of them out of Sunmeadow, the green ring just outside our walls.',
      remind: 'Puffcaps hop about in Sunmeadow, just past the plaza. Follow any road out of town.',
      done: 'The lamps will burn bright tonight. Here is some coin, and a couple of tonics for your bag.',
    },
    {
      title: 'Toads in the Reeds', objective: { kind: 'defeat', monster: 'toad', count: 5 }, accept: true, turnIn: 'maren',
      where: 'Reedmere · west along the road', recommended: 'Level 3–5', reward: { xp: 180, gold: 35, tonics: 1 },
      offer: 'Bog toads have swarmed Reedmere, the lake to the west. Their croaking keeps the fishers up all night. Five should quiet them.',
      remind: 'Take the west road to Reedmere. The toads sit by the water.',
      done: 'Blessed quiet! The fishers send their thanks, and so do my ears.',
    },
    {
      title: 'Bristle and Tusk', objective: { kind: 'collect', monster: 'boar', count: 5, item: 'Boar tusk' }, accept: true, turnIn: 'maren',
      where: 'Lanternwood · east, under the autumn trees', recommended: 'Level 5–7', reward: { xp: 320, gold: 50, tonics: 1 },
      offer: 'Oda wants boar tusks for new blade handles. Bramble boars roam Lanternwood, the autumn forest to the east. Bring back five.',
      remind: 'Not every boar carries a good tusk. Keep hunting in Lanternwood.',
      done: 'Fine tusks. Oda will be pleased. Take this for the road.',
    },
    {
      title: 'Shells of the Dunes', objective: { kind: 'defeat', monster: 'scuttler', count: 6 }, accept: true, turnIn: 'maren',
      where: 'Amber Dunes · south past the meadow', recommended: 'Level 7–9', reward: { xp: 520, gold: 70, tonics: 2 },
      offer: 'Scuttlers are digging under the southern road through the Amber Dunes. Break six shells and the caravans can move again.',
      remind: 'The south road leads straight into the dunes. Mind their claws.',
      done: 'The caravans are rolling again. You have grown strong, keeper.',
    },
    {
      title: 'Golems of Frostspine', objective: { kind: 'defeat', monster: 'golem', count: 4 }, accept: true, turnIn: 'maren',
      where: 'Frostspine Peaks · north, up the slopes', recommended: 'Level 10–12', reward: { xp: 850, gold: 90, tonics: 2 },
      offer: 'Something is waking the frost golems in the northern peaks. Break four of them and see what glows at the summit.',
      remind: 'Climb north into Frostspine. Bring tonics.',
      done: 'Four golems, and a cold light at the top of Frostspine. The Warden stirs. Rest, then climb.',
    },
    {
      title: 'The Frost Heart', objective: { kind: 'defeat', monster: 'warden', count: 1 }, accept: true, turnIn: 'maren',
      where: 'Frostspine summit · the highest peak', recommended: 'Level 12+', reward: { xp: 1600, gold: 200, title: 'hero', mount: 'elk' },
      offer: 'On the highest peak of Frostspine stands the Warden of the Frost Heart. Defeat it, and the lanterns of the realm will never dim again.',
      remind: 'The Warden waits on the highest peak. Step out of the red ring before its slam lands.',
      done: 'You did it. Every lantern in Emberhold is singing. The frost elk of the peaks came down to the gate this morning and would not leave. I think it is waiting for you, Hero of the Realm.',
    },
  ],
};

const BELL: StoryChain = {
  id: 'bell',
  title: 'The Drowned Bell',
  giver: 'tamsin',
  minLevel: 3,
  steps: [
    {
      title: 'A Bell Beneath the Water', objective: { kind: 'visit', place: 'sunken-pier' }, accept: true, turnIn: null,
      where: 'Reedmere · the Sunken Pier on the shore', recommended: 'Level 3+', reward: { xp: 120, gold: 20 },
      offer: 'Every night a bell rings under Reedmere, and no bell has hung here for a hundred years. Look along the shore for the old sunken pier. That is where the water is deepest.',
      remind: 'The Sunken Pier is on the Reedmere shore. Follow the marker on your map.',
      done: 'Under the pier, something bronze glints in the mud, and the toads keep snapping at it.',
    },
    {
      title: 'Shards in the Mud', objective: { kind: 'collect', monster: 'toad', count: 4, item: 'Bell shard' }, accept: false, turnIn: null,
      where: 'Reedmere · the bog toads', reward: { xp: 160, gold: 25 },
      offer: 'The bog toads swallow anything that shines. Four shards of that bell should be enough to know what it was.',
      remind: 'Bog toads swallow anything that shines. Collect four bell shards in Reedmere.',
      done: 'Four bronze shards, green with age, each stamped with a tiny lantern.',
    },
    {
      title: 'What the Elder Remembers', objective: { kind: 'talk', npc: 'maren' }, accept: false, turnIn: 'maren',
      where: 'Emberhold · Elder Maren by the fountain', reward: { xp: 120, gold: 0 },
      offer: 'Elder Maren is the oldest soul in Emberhold. Show her the shards.',
      remind: 'Take the bell shards to Elder Maren by the fountain.',
      done: 'The Night Bell. It hung in Reedmere when I was a girl, and it rang whenever the Gloom came for our lanterns. If it rings again, the Gloom is waking. Tell Tamsin to keep her lamps lit.',
    },
    {
      title: 'Ready for the Dark', objective: { kind: 'talk', npc: 'tamsin' }, accept: false, turnIn: 'tamsin',
      where: 'Reedmere road · Tamsin', reward: { xp: 150, gold: 40, marks: 2, title: 'bellfinder' },
      offer: 'Tamsin should hear what Maren said.',
      remind: 'Go back to Tamsin on the Reedmere road.',
      done: 'The Gloom? Then Reedmere will keep its lamps burning, and so will you. Take my grandmother’s charm. They called her the Bellfinder too.',
    },
  ],
};

const THIEF: StoryChain = {
  id: 'thief',
  title: 'The Lantern Thief',
  giver: 'bryn',
  minLevel: 5,
  steps: [
    {
      title: 'Dark Shrines', objective: { kind: 'visit', place: 'hollow-shrine' }, accept: true, turnIn: null,
      where: 'Lanternwood · the Hollow Shrine', recommended: 'Level 5+', reward: { xp: 200, gold: 25 },
      offer: 'The shrine lanterns in my woods keep going dark, as if someone is stealing their flames. Go and look at the Hollow Shrine. Tell me what you see.',
      remind: 'The Hollow Shrine stands among the autumn trees. Follow the marker on your map.',
      done: 'The shrine lamp is cold, and the ground around it is black with ash. Hoofprints everywhere.',
    },
    {
      title: 'Spooked Boars', objective: { kind: 'defeat', monster: 'boar', count: 6 }, accept: false, turnIn: null,
      where: 'Lanternwood · the bramble boars', reward: { xp: 260, gold: 30 },
      offer: 'The boars around the shrine are wild with fear. Calm six of them, the hard way.',
      remind: 'Defeat bramble boars in Lanternwood.',
      done: 'The woods go quiet. Every boar you felled had ash caught in its bristles.',
    },
    {
      title: 'Soot and Ash', objective: { kind: 'collect', monster: 'boar', count: 3, item: 'Sooty bristle' }, accept: false, turnIn: null,
      where: 'Lanternwood · the bramble boars', reward: { xp: 200, gold: 0 },
      offer: 'That ash is a clue. Collect a few of the sootiest bristles.',
      remind: 'Collect sooty bristles from bramble boars.',
      done: 'Three bristles, coated in ash that is cold to the touch.',
    },
    {
      title: 'The Smith’s Eye', objective: { kind: 'talk', npc: 'oda' }, accept: false, turnIn: 'oda',
      where: 'Emberhold · Smith Oda’s forge', reward: { xp: 150, gold: 0 },
      offer: 'Nobody knows soot like a smith. Show the bristles to Oda.',
      remind: 'Show the sooty bristles to Smith Oda in Emberhold.',
      done: 'Soot? No. Forge soot is brown and greasy. This is gloom ash: cold, and it never washes out. Whatever is stealing those flames is not from around here.',
    },
    {
      title: 'Report to Bryn', objective: { kind: 'talk', npc: 'bryn' }, accept: false, turnIn: 'bryn',
      where: 'Lanternwood road · Ranger Bryn', reward: { xp: 250, gold: 50, marks: 2, title: 'shrinekeeper', mount: 'hog' },
      offer: 'Bryn needs to know.',
      remind: 'Tell Ranger Bryn what Oda said.',
      done: 'Gloom ash. Then it is not poachers. Keep your eyes open after dark, keeper. You have earned the name Shrinekeeper, and take Bramble here. She was the calmest hog in the woods, and she has taken a liking to you.',
    },
  ],
};

const RIFT: StoryChain = {
  id: 'rift',
  title: 'Glass of the Rift',
  giver: 'sefa',
  minLevel: 7,
  steps: [
    {
      title: 'Lights Over the Sea', objective: { kind: 'visit', place: 'rift-lookout' }, accept: true, turnIn: null,
      where: 'Amber Dunes · the Rift Lookout on the southern cliffs', recommended: 'Level 7+', reward: { xp: 320, gold: 30 },
      offer: 'My drivers see purple light past the southern cliffs at night. They will not go near it. You might. Climb to the lookout and tell me what is out there.',
      remind: 'The Rift Lookout is on the southern cliffs. Follow the marker on your map.',
      done: 'Far past the cliffs, purple light flickers over islands that were not there last season.',
    },
    {
      title: 'Glass in the Sand', objective: { kind: 'collect', monster: 'scuttler', count: 4, item: 'Rift glass' }, accept: false, turnIn: null,
      where: 'Amber Dunes · the dune scuttlers', reward: { xp: 380, gold: 35 },
      offer: 'The scuttlers have been digging up purple glass. Bring me four pieces.',
      remind: 'Collect rift glass from dune scuttlers.',
      done: 'Four shards of glass, faintly warm, humming when you hold them up to the light.',
    },
    {
      title: 'A Thin Sky', objective: { kind: 'talk', npc: 'ilka' }, accept: false, turnIn: 'ilka',
      where: 'Emberhold · Seer Ilka', reward: { xp: 300, gold: 0 },
      offer: 'There is a seer in Emberhold, Ilka. If anyone knows what this glass is, she does.',
      remind: 'Show the rift glass to Seer Ilka in Emberhold.',
      done: 'Rift glass. The sky is thin out there, thin enough to step through. Soon I will be able to hold a door open. When I can, you will be the first through it.',
    },
    {
      title: 'Back to the Caravan', objective: { kind: 'talk', npc: 'sefa' }, accept: false, turnIn: 'sefa',
      where: 'Amber Dunes road · Sefa', reward: { xp: 400, gold: 60, marks: 3, title: 'glasswalker' },
      offer: 'Sefa will want to hear this.',
      remind: 'Tell Sefa on the Amber Dunes road what Ilka said.',
      done: 'Doors in the sky? Hah. Then my caravans will need someone who has walked through one. Glasswalker, they will call you.',
    },
  ],
};

export const CHAINS: readonly StoryChain[] = [MAIN, BELL, THIEF, RIFT];

export const CHAIN_IDS: readonly ChainId[] = CHAINS.map((c) => c.id);

export const isChainId = (v: unknown): v is ChainId => typeof v === 'string' && CHAIN_IDS.includes(v as ChainId);

export const chainById = (id: ChainId): StoryChain => CHAINS.find((c) => c.id === id)!;

// ---------------------------------------------------------------- progress

/** `available`: waiting to be accepted. `active`: under way. `ready`: objective met, to be turned in. */
export type StepState = 'available' | 'active' | 'ready';

export const STEP_STATES: readonly StepState[] = ['available', 'active', 'ready'];

export interface ChainProgress {
  /** Index of the current step; equal to the number of steps once the chain is finished. */
  step: number;
  /** Objective count so far (kills, items). */
  progress: number;
  state: StepState;
}

export type StoryProgress = Record<ChainId, ChainProgress>;

export const newChainProgress = (): ChainProgress => ({ step: 0, progress: 0, state: 'available' });

export const newStoryProgress = (): StoryProgress =>
  Object.fromEntries(CHAIN_IDS.map((id) => [id, newChainProgress()])) as StoryProgress;

/** How a chain looks to a hero right now. */
export type ChainStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';

export function chainStatus(chain: StoryChain, cp: ChainProgress, level: number): ChainStatus {
  if (cp.step >= chain.steps.length) return 'done';
  if (cp.step === 0 && cp.state === 'available' && level < chain.minLevel) return 'locked';
  return cp.state;
}

export const currentStep = (chain: StoryChain, cp: ChainProgress): StoryStep | null => chain.steps[cp.step] ?? null;

/** How many of the objective's thing it takes. */
export const objectiveNeed = (o: Objective): number => (o.kind === 'defeat' || o.kind === 'collect' ? o.count : 1);

/** One line describing the objective, with progress where it counts things. */
export function objectiveText(o: Objective, progress: number): string {
  switch (o.kind) {
    case 'defeat': {
      const name = MONSTERS[o.monster].name;
      return o.count === 1 ? `Defeat the ${name}` : `${name}s defeated ${Math.min(progress, o.count)} / ${o.count}`;
    }
    case 'collect':
      return `${o.item}s ${Math.min(progress, o.count)} / ${o.count}`;
    case 'visit':
      return `Find ${LANDMARK_NAMES[o.place]}`;
    case 'talk':
      return `Talk to ${npcName(o.npc)}`;
  }
}
