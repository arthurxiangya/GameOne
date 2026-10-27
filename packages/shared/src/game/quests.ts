import type { MonsterType } from './monsters';

export type QuestState = 'available' | 'active' | 'ready' | 'done';

export const QUEST_STATES: readonly QuestState[] = ['available', 'active', 'ready', 'done'];

export interface QuestDef {
  readonly title: string;
  readonly target: MonsterType;
  readonly need: number;
  /** Collect quests drop this item from the target with ITEM_DROP_CHANCE. */
  readonly item: string | null;
  readonly label: string;
  readonly where: string;
  readonly recommended: string;
  readonly xp: number;
  readonly gold: number;
  readonly tonics: number;
  readonly offer: string;
  readonly remind: string;
  readonly done: string;
}

export const ITEM_DROP_CHANCE = 0.72;

export const QUESTS: readonly QuestDef[] = [
  {
    title: 'Puffcap Trouble', target: 'puffcap', need: 6, item: null, label: 'Puffcaps defeated',
    where: 'Sunmeadow · the green ring around town', recommended: 'Level 1–3', xp: 90, gold: 25, tonics: 2,
    offer: 'Puffcaps have been nibbling the lantern oil again. Clear six of them out of Sunmeadow, the green ring just outside our walls.',
    remind: 'Puffcaps hop about in Sunmeadow, just past the plaza. Follow any road out of town.',
    done: 'The lamps will burn bright tonight. Here is some coin, and a couple of tonics for your bag.',
  },
  {
    title: 'Toads in the Reeds', target: 'toad', need: 5, item: null, label: 'Bog toads defeated',
    where: 'Reedmere · west along the road', recommended: 'Level 3–5', xp: 180, gold: 35, tonics: 1,
    offer: 'Bog toads have swarmed Reedmere, the lake to the west. Their croaking keeps the fishers up all night. Five should quiet them.',
    remind: 'Take the west road to Reedmere. The toads sit by the water.',
    done: 'Blessed quiet! The fishers send their thanks, and so do my ears.',
  },
  {
    title: 'Bristle and Tusk', target: 'boar', need: 5, item: 'Boar tusk', label: 'Boar tusks',
    where: 'Lanternwood · east, under the autumn trees', recommended: 'Level 5–7', xp: 320, gold: 50, tonics: 1,
    offer: 'Oda wants boar tusks for new blade handles. Bramble boars roam Lanternwood, the autumn forest to the east. Bring back five.',
    remind: 'Not every boar carries a good tusk. Keep hunting in Lanternwood.',
    done: 'Fine tusks. Oda will be pleased. Take this for the road.',
  },
  {
    title: 'Shells of the Dunes', target: 'scuttler', need: 6, item: null, label: 'Scuttlers defeated',
    where: 'Amber Dunes · south past the meadow', recommended: 'Level 7–9', xp: 520, gold: 70, tonics: 2,
    offer: 'Scuttlers are digging under the southern road through the Amber Dunes. Break six shells and the caravans can move again.',
    remind: 'The south road leads straight into the dunes. Mind their claws.',
    done: 'The caravans are rolling again. You have grown strong, keeper.',
  },
  {
    title: 'Golems of Frostspine', target: 'golem', need: 4, item: null, label: 'Frost golems broken',
    where: 'Frostspine Peaks · north, up the slopes', recommended: 'Level 10–12', xp: 850, gold: 90, tonics: 2,
    offer: 'Something is waking the frost golems in the northern peaks. Break four of them and see what glows at the summit.',
    remind: 'Climb north into Frostspine. Bring tonics.',
    done: 'Four golems, and a cold light at the top of Frostspine. The Warden stirs. Rest, then climb.',
  },
  {
    title: 'The Frost Heart', target: 'warden', need: 1, item: null, label: 'Warden defeated',
    where: 'Frostspine summit · the highest peak', recommended: 'Level 12+', xp: 1600, gold: 200, tonics: 0,
    offer: 'On the highest peak of Frostspine stands the Warden of the Frost Heart. Defeat it, and the lanterns of the realm will never dim again.',
    remind: 'The Warden waits on the highest peak. Step out of the red ring before its slam lands.',
    done: 'You did it. Every lantern in Emberhold is singing. Stay as long as you like, hero of the realm.',
  },
];

export const questAt = (index: number): QuestDef | undefined => QUESTS[index];
