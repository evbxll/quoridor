const NAMES = [
  "horizontal walls",
  "vertical walls",
  "mover pawn",
  "opponent pawn",
  "mover walls left",
  "opponent walls left",
  "mover goal distance",
  "opponent goal distance",
  "mover shortest-path cells",
  "opponent shortest-path cells",
];

export const SHA = "a".repeat(64);

/** A card.json as the publisher writes it (a conv net with 10 planes by default); `over` replaces top-level fields. */
export function cardJson(id: string, over: Record<string, unknown> = {}, sha256 = SHA): Record<string, unknown> {
  return {
    id,
    display_name: "Convolutional",
    sizes: [5, 7, 9, 11],
    sha256,
    license: "CC-BY-4.0",
    trained_size: 9,
    parameters: 2474767,
    network: { head: "conv", input_planes: 10, channels: 128, blocks: 8, pool_every: 3, head_channels: 32, board_size: null },
    plane_names: NAMES,
    strength: [{ size: 9, elo_vs_normal: 518 }],
    ...over,
  };
}

/** The card of a 6-plane fc model trained on 9x9. */
export function fcCardJson(id: string, sha256 = SHA): Record<string, unknown> {
  return cardJson(
    id,
    {
      display_name: "Fully connected",
      sizes: [9],
      network: { head: "fc", input_planes: 6, channels: 128, blocks: 8, pool_every: null, head_channels: null, board_size: 9 },
      plane_names: NAMES.slice(0, 6),
    },
    sha256,
  );
}
