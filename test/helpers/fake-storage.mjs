// In-memory Storage stand-in for the progress store tests. `initial` seeds keys,
// `throwOn` names methods that throw (as a quota-exceeded or private-mode Storage
// does). Every setItem attempt is recorded in `sets`, in order, even one that throws.
export function fakeStorage({ initial = {}, throwOn = [] } = {}) {
  const data = new Map(Object.entries(initial));
  const sets = [];
  const fail = (method) => {
    if (throwOn.includes(method)) throw new Error(`fake storage: ${method} refused`);
  };
  return {
    data,
    sets,
    getItem(key) {
      fail('getItem');
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      sets.push([key, String(value)]);
      fail('setItem');
      data.set(key, String(value));
    },
  };
}
