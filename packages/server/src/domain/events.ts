import type { GameEvent } from '@lanternwood/shared';

/** A game event plus who should receive it. */
export type RoutedEvent =
  | { readonly scope: 'area'; readonly x: number; readonly z: number; readonly event: GameEvent }
  | { readonly scope: 'player'; readonly playerId: number; readonly event: GameEvent };

/** Domain services report what happened through this port; they never touch the network. */
export interface EventSink {
  /** Visible to every player near (x, z). */
  area(x: number, z: number, event: GameEvent): void;
  /** Visible only to one player. */
  player(playerId: number, event: GameEvent): void;
}

export class EventBuffer implements EventSink {
  private items: RoutedEvent[] = [];

  area(x: number, z: number, event: GameEvent): void {
    this.items.push({ scope: 'area', x, z, event });
  }

  player(playerId: number, event: GameEvent): void {
    this.items.push({ scope: 'player', playerId, event });
  }

  drain(): RoutedEvent[] {
    const out = this.items;
    this.items = [];
    return out;
  }
}
