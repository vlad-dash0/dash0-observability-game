// A Trade-off spec for the widget tests (core and view): two knobs of three options, cap 12.
// A fresh copy per call, so a test may edit it. Cheap plans drop a need; the plans that keep
// both needs and cost 17+ are over the cap; the reference plan (tail + tier) costs 11.

export function spec() {
  return {
    id: 'bill',
    unit: 'GB/day',
    cap: 12,
    knobs: [
      {
        id: 'sampling',
        label: 'Sampling',
        options: [
          { id: 'head', label: 'Head 5%', cost: 2 },
          { id: 'tail', label: 'Tail: keep errors', cost: 8, keeps: ['errors'] },
          { id: 'all', label: 'Keep everything', cost: 18, keeps: ['errors'] },
        ],
      },
      {
        id: 'attrs',
        label: 'User attribute',
        options: [
          { id: 'none', label: 'Drop it', cost: 1 },
          { id: 'tier', label: 'user.tier', cost: 3, keeps: ['per-user'] },
          { id: 'user', label: 'user.id', cost: 9, keeps: ['per-user'] },
        ],
      },
    ],
    needs: [
      { id: 'errors', label: 'every error trace' },
      { id: 'per-user', label: 'a per-user view' },
    ],
    answer: { sampling: 'tail', attrs: 'tier' },
    whyNot: { 'attrs:user': 'A raw user id has a new value for every user.' },
    explain: 'Tail sampling keeps the errors; a tier is bounded.',
  };
}
