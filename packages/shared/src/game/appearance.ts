export interface Look {
  readonly cloak: number;
  readonly hood: number;
  readonly skin: number;
  readonly boots: number;
}

/** Palettes for player heroes. The server assigns one per account. */
export const PLAYER_LOOKS: readonly Look[] = [
  { cloak: 0x2f6b5a, hood: 0xe8742e, skin: 0xf0d2b0, boots: 0x3b2e2a },
  { cloak: 0x3b5ea8, hood: 0xd9d2c0, skin: 0xc99a72, boots: 0x2e2622 },
  { cloak: 0x8c3b3b, hood: 0x2f2f36, skin: 0xe6be98, boots: 0x2e2622 },
  { cloak: 0x7a4fa0, hood: 0x9fe0d8, skin: 0x9c6b4a, boots: 0x2e2622 },
  { cloak: 0xc46a2c, hood: 0x40566e, skin: 0xf2dcc2, boots: 0x2e2622 },
  { cloak: 0x2f7d4f, hood: 0xe0b23e, skin: 0xd9a77f, boots: 0x3b2e2a },
];

export const lookAt = (index: number): Look => PLAYER_LOOKS[((index % PLAYER_LOOKS.length) + PLAYER_LOOKS.length) % PLAYER_LOOKS.length]!;

/** Picks a stable palette from an account id. */
export function lookForAccount(accountId: string): number {
  let h = 0;
  for (let i = 0; i < accountId.length; i++) h = (Math.imul(h, 31) + accountId.charCodeAt(i)) | 0;
  return Math.abs(h) % PLAYER_LOOKS.length;
}
