import { isSkillId, type SkillId } from '@lanternwood/shared';

export interface SkillBarHandlers {
  skill(id: SkillId): void;
  strikeHeld(held: boolean): void;
  jump(held: boolean): void;
}

/** Wires the on-screen skill buttons. Uses pointerdown so taps register instantly on phones. */
export function bindSkillBar(root: HTMLElement, handlers: SkillBarHandlers): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('.sk')) {
    const action = button.dataset.skill;
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      button.classList.add('down');
      try {
        button.setPointerCapture(e.pointerId);
      } catch {
        // Not critical: the button still works without capture.
      }
      if (action === 'jump') handlers.jump(true);
      else if (isSkillId(action)) {
        if (action === 'strike') handlers.strikeHeld(true);
        handlers.skill(action);
      }
    });
    const release = (): void => {
      button.classList.remove('down');
      if (action === 'strike') handlers.strikeHeld(false);
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
