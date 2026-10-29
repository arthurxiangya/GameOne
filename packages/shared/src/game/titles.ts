/** Titles a hero can earn and show under their name. */
export type TitleId = 'hero' | 'bellfinder' | 'shrinekeeper' | 'glasswalker' | 'lanternbearer';

export interface TitleDef {
  readonly name: string;
  /** How the title is earned, for the journal. */
  readonly how: string;
}

export const TITLES: Readonly<Record<TitleId, TitleDef>> = {
  hero: { name: 'Hero of the Realm', how: 'Defeat the Warden of the Frost Heart' },
  bellfinder: { name: 'Bellfinder', how: 'Finish The Drowned Bell' },
  shrinekeeper: { name: 'Shrinekeeper', how: 'Finish The Lantern Thief' },
  glasswalker: { name: 'Glasswalker', how: 'Finish Glass of the Rift' },
  lanternbearer: { name: 'Lanternbearer', how: 'Trade Ember Marks with Smith Oda' },
};

export const TITLE_IDS = Object.keys(TITLES) as readonly TitleId[];

export const isTitleId = (v: unknown): v is TitleId => typeof v === 'string' && v in TITLES;
