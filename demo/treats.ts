// Pakkun earns 2 treats per walk, up to 6 a day. The demo's bug: the cap says 5.
// `scripts/stage-demo.sh fix` fixes it (5 -> 6); scripts/stage-demo.sh reset puts the bug back.
export const treats = (walks: number): number => Math.min(walks * 2, 5);
