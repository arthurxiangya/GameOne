export interface SkillBarHandlers {
  /** One of the four class skill slots, 0–3. */
  slot(index: number): void;
  tonic(): void;
  /** Slot 1 (the basic attack) repeats while held. */
  basicHeld(held: boolean): void;
  jump(held: boolean): void;
}

/** Wires the on-screen skill buttons. Uses pointerdown so taps register instantly on phones. */
export function bindSkillBar(root: HTMLElement, handlers: SkillBarHandlers): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('.sk')) {
    const action = button.dataset.skill;
    const slot = button.dataset.slot === undefined ? null : Number(button.dataset.slot);
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      button.classList.add('down');
      try {
        button.setPointerCapture(e.pointerId);
      } catch {
        // Not critical: the button still works without capture.
      }
      if (action === 'jump') handlers.jump(true);
      else if (action === 'tonic') handlers.tonic();
      else if (slot !== null) {
        if (slot === 0) handlers.basicHeld(true);
        handlers.slot(slot);
      }
    });
    const release = (): void => {
      button.classList.remove('down');
      if (slot === 0) handlers.basicHeld(false);
      if (action === 'jump') handlers.jump(false);
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('click', (e) => {
      e.preventDefault();
      button.blur();
    });
  }
}
