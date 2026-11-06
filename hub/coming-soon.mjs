// Acts shown on the hub and the globe but not playable (#177 P7). Never in levels/index.mjs ACTS,
// so never in the registry, unlock, progress, stars or cards. When an act gets its first level, add
// it to ACTS and delete its entry here (test/coming-soon.test.mjs fails while it is in both).
// Empty since Act 8 went live with 8.2: the mechanism stays for the next act that is announced early.
export const COMING_SOON = Object.freeze([]);
