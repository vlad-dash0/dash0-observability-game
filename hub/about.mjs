// Copy for the hub's About dialog (index.html .about, createGame.aboutActs). Plain text,
// rendered with x-text. The act list itself comes from act data, never from here.
export const GAME_SUMMARY =
  'You are the new on-call engineer at a small company. Each act teaches one part of ' +
  'observability, with OpenTelemetry and Dash0. Each level you finish lights up a country on the ' +
  "globe.";

// The "How this game works" topic for the map: the loop from a lit country to a calm region.
export const GLOBE_LOOP = Object.freeze({
  title: 'The map',
  text:
    'Finish a level and its country lights up. Finish every level in a region and production goes down ' +
    'there: the region pulses until you fix its incident. Fix it and the region turns a calm green, and ' +
    'the next region opens. A region with no incident turns green once its levels are done.',
});
