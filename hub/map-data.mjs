// The system map the player is on call for (docs/FOUNDATION.md §2.7): a small shop.
// Nodes sit in an SVG viewBox of 0 0 100 60, laid out left to right in the direction
// requests flow; a level names node ids in its `lights`. Edges point from caller to
// callee (or producer to queue to consumer). Ids are never renamed: levels refer to them.
// kind: 'service' | 'datastore' | 'queue' | 'external'.
export const NODES = Object.freeze([
  { id: 'storefront', label: 'Storefront', kind: 'service', x: 8, y: 30 },
  { id: 'api-gateway', label: 'API gateway', kind: 'service', x: 25, y: 30 },
  { id: 'catalog', label: 'Catalog', kind: 'service', x: 45, y: 7 },
  { id: 'cart', label: 'Cart', kind: 'service', x: 45, y: 21 },
  { id: 'checkout', label: 'Checkout', kind: 'service', x: 45, y: 36 },
  { id: 'recommendations', label: 'Recommendations', kind: 'service', x: 45, y: 50 },
  { id: 'redis', label: 'Redis', kind: 'datastore', x: 25, y: 47 },
  { id: 'inventory', label: 'Inventory', kind: 'service', x: 66, y: 9 },
  { id: 'payments', label: 'Payments', kind: 'service', x: 66, y: 24 },
  { id: 'orders', label: 'Orders', kind: 'service', x: 66, y: 38 },
  { id: 'kafka', label: 'Kafka', kind: 'queue', x: 66, y: 51 },
  { id: 'payment-provider', label: 'Payment provider', kind: 'external', x: 86, y: 14 },
  { id: 'postgres', label: 'Postgres', kind: 'datastore', x: 86, y: 30 },
  { id: 'shipping', label: 'Shipping', kind: 'service', x: 86, y: 43 },
  { id: 'notifications', label: 'Notifications', kind: 'service', x: 86, y: 53 },
].map(Object.freeze));

export const EDGES = Object.freeze([
  { from: 'storefront', to: 'api-gateway' },
  { from: 'api-gateway', to: 'catalog' },
  { from: 'api-gateway', to: 'cart' },
  { from: 'api-gateway', to: 'checkout' },
  { from: 'api-gateway', to: 'recommendations' },
  { from: 'catalog', to: 'postgres' },
  { from: 'cart', to: 'redis' },
  { from: 'recommendations', to: 'redis' },
  { from: 'checkout', to: 'cart' },
  { from: 'checkout', to: 'inventory' },
  { from: 'checkout', to: 'payments' },
  { from: 'checkout', to: 'orders' },
  { from: 'inventory', to: 'postgres' },
  { from: 'payments', to: 'payment-provider' },
  { from: 'orders', to: 'postgres' },
  { from: 'orders', to: 'kafka' },
  { from: 'kafka', to: 'shipping' },
  { from: 'kafka', to: 'notifications' },
].map(Object.freeze));
