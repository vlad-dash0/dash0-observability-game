// The ids a level's `lights` may name (docs/FOUNDATION.md §2.7). They were the nodes of the
// SVG system map, which the globe replaced (#150); `lights` stays level data and is checked
// against this list by buildRegistry, but nothing draws it any more. Ids are never renamed:
// levels refer to them.
export const NODE_IDS = Object.freeze([
  'storefront',
  'api-gateway',
  'catalog',
  'cart',
  'checkout',
  'recommendations',
  'redis',
  'inventory',
  'payments',
  'orders',
  'kafka',
  'payment-provider',
  'postgres',
  'shipping',
  'notifications',
  'collector',
]);
