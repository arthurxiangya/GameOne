import {
  EGG_HATCH_KILLS,
  MOUNTS,
  MOUNT_IDS,
  PETS,
  PET_IDS,
  PET_MAX_LEVEL,
  petBonusAt,
  type MountId,
  type PetBonus,
  type PetId,
  type PetState,
  type PlayerProgress,
} from '@lanternwood/shared';
import { byId, el } from './dom';

export interface StableHandlers {
  chooseMount(id: MountId | null): void;
  choosePet(id: PetId | null): void;
  renamePet(id: PetId, name: string): void;
}

const percent = (v: number): string => `+${Math.round(v * 100)}%`;

/** "+4% gold from monsters" for a pet at its level. */
function bonusText(pet: PetState): string {
  const def = PETS[pet.id];
  const kinds = Object.keys(def.bonus) as PetBonus[];
  const amount = kinds.map((k) => percent(petBonusAt(pet.id, pet.level, k))).join(' / ');
  return `${amount} ${def.describe}`;
}

/** The stable (P): mounts to ride, pets to follow you, and eggs waiting to hatch. */
export class StableView {
  private readonly root = byId('stable');
  private readonly body = byId('sBody');
  private renaming: PetId | null = null;
  private last: PlayerProgress | null = null;

  constructor(private readonly handlers: StableHandlers) {
    byId('sClose').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    this.renaming = null;
  }

  open(p: PlayerProgress): void {
    this.root.hidden = false;
    this.render(p);
  }

  refresh(p: PlayerProgress): void {
    if (this.isOpen) this.render(p);
  }

  private render(p: PlayerProgress): void {
    this.last = p;
    const mounts = el('section', 'j-sec');
    mounts.append(el('h3', undefined, 'Mounts · R to ride'));
    for (const id of MOUNT_IDS) {
      const def = MOUNTS[id];
      const owned = p.mounts.includes(id);
      const chosen = p.mount === id;
      const row = el('div', `j-row static${owned ? (chosen ? ' on' : '') : ' quiet'}`);
      row.append(el('b', undefined, def.name), el('span', undefined, owned ? `${percent(def.speed - 1)} speed on land` : def.how));
      if (owned) row.append(this.button(chosen ? 'Chosen' : 'Choose', chosen, () => this.handlers.chooseMount(id)));
      mounts.append(row);
    }

    const pets = el('section', 'j-sec');
    pets.append(el('h3', undefined, 'Pets'));
    for (const pet of p.pets) pets.append(this.petRow(pet, p.pet === pet.id));
    if (p.pet) pets.append(this.button('Send your pet home', false, () => this.handlers.choosePet(null), 'ghost-wide'));
    for (const egg of p.eggs) {
      const row = el('div', 'j-row static');
      row.append(el('b', undefined, `${PETS[egg.pet].name} egg`), el('span', undefined, 'Hatches after more victories with it in your bag'), el('em', undefined, `${egg.kills} / ${EGG_HATCH_KILLS}`));
      pets.append(row);
    }
    for (const id of PET_IDS) {
      if (p.pets.some((x) => x.id === id) || p.eggs.some((e) => e.pet === id)) continue;
      const row = el('div', 'j-row static quiet');
      row.append(el('b', undefined, PETS[id].name), el('span', undefined, `${PETS[id].how} · more ${PETS[id].describe}`));
      pets.append(row);
    }
    this.body.replaceChildren(mounts, pets);
  }

  private petRow(pet: PetState, following: boolean): HTMLElement {
    const row = el('div', `j-row static${following ? ' on' : ''}`);
    const species = PETS[pet.id].name;
    if (this.renaming === pet.id) {
      const form = el('form', 'rename');
      const input = el('input');
      input.type = 'text';
      input.maxLength = 14;
      input.value = pet.name;
      input.setAttribute('aria-label', `New name for your ${species}`);
      const save = el('button', 'btn primary', 'Save');
      save.type = 'submit';
      form.append(input, save);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.renaming = null;
        if (input.value.trim() && input.value !== pet.name) this.handlers.renamePet(pet.id, input.value);
        if (this.last) this.render(this.last);
      });
      row.append(form);
      queueMicrotask(() => input.focus());
      return row;
    }
    const level = pet.level >= PET_MAX_LEVEL ? 'Level 10 (max)' : `Level ${pet.level}`;
    row.append(el('b', undefined, pet.name === species ? species : `${pet.name} · ${species}`), el('span', undefined, `${level} · ${bonusText(pet)}`));
    const buttons = el('div', 'row-acts');
    buttons.append(
      this.button(following ? 'Following' : 'Follow me', following, () => this.handlers.choosePet(pet.id)),
      this.button('Rename', false, () => {
        this.renaming = pet.id;
        row.replaceWith(this.petRow(pet, following));
      }),
    );
    row.append(buttons);
    return row;
  }

  private button(label: string, pressed: boolean, run: () => void, extra = ''): HTMLButtonElement {
    const b = el('button', `chip${pressed ? ' on' : ''}${extra ? ` ${extra}` : ''}`, label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', run);
    return b;
  }
}
