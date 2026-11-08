// Level 8.1: Dashboards as code. Act 8 "Operating at scale". Kettle & Co keeps its dashboards in git and applies them with the Dash0
// operator for Kubernetes. The player reviews the added lines of a pull request that creates one dashboard file in the Perses format
// Dash0 uses and spots the three lines a reviewer should stop (Spot it): a namespace the operator does not watch, a grid item that
// overlaps its neighbour, and a layout item that names a panel the file never defines. Then one Choice: how a team with no Kubernetes
// cluster, whose infrastructure is already in Terraform, gets reviewed dashboards into Dash0. Hints are off on the Spot it step (the
// default ladder: hints in early acts only). Nothing is parsed or applied.
// Spec: https://www.dash0.com/docs/dash0/dashboards/manage-dashboards-as-code , https://www.dash0.com/docs/dash0/dashboards/export-dashboards
// Dash0 docs: https://www.dash0.com/docs/dash0/dashboards/manage-dashboards-as-code
//
// Facts used (each read on the pages above, 2026-11-07). Manage Dashboards as Code: Dash0 dashboards use the Perses dashboard format;
// they can be versioned and managed as infrastructure as code, which enables version control, automated deployment pipelines and code
// review for dashboard changes. With the Dash0 Operator for Kubernetes a dashboard is a Perses `PersesDashboard` custom resource
// (`apiVersion: perses.dev/v1alpha1`, `metadata.name` and `metadata.namespace`, and under `spec`: `display.name`, `datasources`
// with `plugin.kind: PrometheusDataSource`, `layouts` of `kind: Grid` whose `spec.items` have `x`, `y`, `width`, `height` and
// `content.$ref: "#/spec/panels/<name>"`, and `panels` of `kind: Panel` with a `TimeSeriesChart` plugin whose
// `PrometheusTimeSeriesQuery` holds a `query`); the operator watches for Perses dashboard resources in namespaces with a Dash0
// monitoring resource deployed, and creates, updates or removes the Dash0 dashboard when the resource is created, modified or deleted.
// The Dash0 Terraform provider (`dash0hq/dash0`) has a `dash0_dashboard` resource with a `dataset` and the Perses YAML in
// `dashboard_yaml`, which holds the same document (`apiVersion`, `kind`, `metadata`, `spec`). The Dash0 CLI creates a dashboard from a
// YAML or JSON file. "Edit as JSON" applies changes immediately when saved and is described as convenient for quick edits and
// prototyping. Export Dashboards: the Source tab downloads a dashboard as Perses YAML, for sharing, version control or migration.
//
// Stated as reasoning, with no source: that a layout item covers the cells from x to x + width and from y to y + height (read from the
// field names in the Dash0 page's example, whose one item has x, y, width and height), so two items that share a row overlap when one
// starts before the other ends; that an item whose `$ref` names no panel of the file has nothing to draw; that the grid items and
// panels of this board are the game's own; and that a team without a cluster has nowhere to run the operator. Perses itself
// (perses.dev) is not an allowed host, so no field beyond the Dash0 page's example is shown and no Perses rule is claimed.
//
// Invented for the game: the company, the file `dashboards/checkout-overview.yaml`, the namespaces `checkout`, `payments` and `tools`,
// the panel names, the queries and the grid sizes. Each line of the board is one added key, shown with its path from the top of the file.

const SPOT = {
  id: 'dac-spot',
  target: 'config',
  helps: { hints: false },
  lines: [
    { id: 'header', text: '+ {apiVersion: perses.dev/v1alpha1, kind: PersesDashboard}' },
    { id: 'metadata', text: '+ metadata: {name: checkout-overview, namespace: tools}' },
    { id: 'display', text: '+ spec.display: {name: Checkout overview}' },
    { id: 'datasource', text: '+ spec.datasources.default: {name: default, plugin: {kind: PrometheusDataSource}}' },
    { id: 'grid', text: '+ spec.layouts[0].kind: Grid' },
    { id: 'item-rate', text: '+ spec.layouts[0].spec.items[0]: {x: 0, "y": 0, width: 12, height: 6, content: {$ref: "#/spec/panels/request_rate"}}' },
    { id: 'item-errors', text: '+ spec.layouts[0].spec.items[1]: {x: 6, "y": 0, width: 12, height: 6, content: {$ref: "#/spec/panels/error_ratio"}}' },
    { id: 'item-latency', text: '+ spec.layouts[0].spec.items[2]: {x: 0, "y": 6, width: 12, height: 6, content: {$ref: "#/spec/panels/latency_p99"}}' },
    { id: 'panel-rate', text: '+ spec.panels.request_rate: {kind: Panel, spec: {display: {name: Request rate}, plugin: {kind: TimeSeriesChart}}}' },
    { id: 'query-rate', text: '+ spec.panels.request_rate.spec.plugin.spec.queries[0].spec.plugin.spec.query: sum(rate(http_server_requests_total{service="checkout"}[5m]))' },
    { id: 'panel-errors', text: '+ spec.panels.error_ratio: {kind: Panel, spec: {display: {name: Error ratio}, plugin: {kind: TimeSeriesChart}}}' },
    { id: 'query-errors', text: '+ spec.panels.error_ratio.spec.plugin.spec.queries[0].spec.plugin.spec.query: sum(rate(http_server_requests_total{service="checkout", code=~"5.."}[5m])) / sum(rate(http_server_requests_total{service="checkout"}[5m]))' },
  ],
  faults: ['metadata', 'item-errors', 'item-latency'],
  whyNot: {
    header: 'The same <code>apiVersion</code> and <code>kind</code> as the example in Dash0\'s documentation of a dashboard the operator manages. Nothing here needs to change.',
    datasource: 'The default data source of the example in Dash0\'s documentation, a Prometheus one. The panels\' queries are PromQL, so it fits.',
    'item-rate': 'Its <code>x: 0</code> is the left edge the item two rows down shares, and its width of 12 is every item\'s width. On its own it is a plain top-left cell; an overlap needs a second item that starts inside it.',
    'panel-errors': 'This panel is defined, and the item that names it points at the right key. What is wrong with that item is where it sits on the grid, not the panel it shows.',
    'query-rate': 'A counter\'s <code>rate</code> over 5 minutes, summed: a request rate per second, the right shape for a counter on a time series chart.',
    'query-errors': 'The share of requests that fail: the rate of 5xx requests divided by the rate of all requests over the same 5 minutes, so it is a ratio between 0 and 1.',
  },
  explain:
    'Three lines to stop. <code>namespace: tools</code>: the operator watches for Perses dashboard resources in namespaces that have a Dash0 monitoring resource, and only <code>checkout</code> and <code>payments</code> do, so a resource applied to <code>tools</code> would never reach Dash0. ' +
    'The second item starts at <code>x: 6</code> but the first one covers 0 to 12 on the same rows (<code>y</code> 0 to 6), so the two charts would be drawn over each other. The other two items start at <code>x: 0</code>, so the second belongs in the next column, at 12. ' +
    'The third item names <code>latency_p99</code>, and the file defines two panels, <code>request_rate</code> and <code>error_ratio</code>, so that item points at nothing: the panel was left out of the pull request. ' +
    'A reviewer can read all three in the diff before anything is live, which is the point of keeping dashboards in git. ' +
    'This step grades the lines you select, not a parsed file: nothing here checks the YAML against the Perses schema.',
};

const DEPLOY = [
  {
    key: 'terraform',
    label: 'Add a <code>dash0_dashboard</code> resource for each dashboard, with its YAML inline and a dataset',
    right: true,
    why:
      'Dash0\'s Terraform provider has a <code>dash0_dashboard</code> resource that takes a <code>dataset</code> and the dashboard as Perses YAML in <code>dashboard_yaml</code>. ' +
      'The file reviewed in the pull request is then what the pipeline applies, next to the rest of payments\' infrastructure, with no cluster involved. ' +
      'The Dash0 CLI can create a dashboard from a file too, but that would be a second way to deploy beside the one the team already runs. ' +
      'Dash0 dashboards use the Perses format, so the YAML is the same document the operator would take, and an export from the Source tab gives you a starting file.',
  },
  {
    key: 'operator',
    label: 'Run the Dash0 operator and commit a <code>PersesDashboard</code> resource for each dashboard file',
    why: 'The operator watches for Perses dashboard resources in namespaces that have a Dash0 monitoring resource, so it needs a Kubernetes cluster to run in. Payments has none, and building one just for dashboards is a much larger change than the one asked for.',
  },
  {
    key: 'json',
    label: 'Keep editing with Edit as JSON in the dashboard, and paste the result into git once it works',
    why: 'Edit as JSON applies changes when you save, so the dashboard is already live before anyone reads the change, and git only records it afterwards. Dash0 describes the editor as convenient for quick edits and experiments, which is what it is for.',
  },
  {
    key: 'export',
    label: 'Export each dashboard as YAML from its Source tab every sprint and commit the files as a record',
    why: 'Exporting gives a snapshot of what is live, for sharing or version control. Changes still happen in Dash0 first and the file records them later, so nothing is reviewed before it goes live.',
  },
];

export default {
  id: 'dashboards-as-code',
  no: '8.1',
  name: 'Dashboards as code',
  sub: 'Review it before it is live',
  icon: '\u{1F4CA}',
  rewardTitle: 'Dashboard reviewer',
  cards: [],
  lights: ['checkout'],
  scoring: { parMs: null },
  play: {
    prefix: 'dac',
    steps: [
      {
        intro:
          'Kettle &amp; Co keeps its dashboards in git and applies them with the Dash0 operator for Kubernetes: a <code>PersesDashboard</code> resource in a namespace that has a Dash0 monitoring resource becomes a dashboard in Dash0. ' +
          'The cluster has monitoring resources in <code>checkout</code> and <code>payments</code>, and none in <code>tools</code>. ' +
          'A pull request adds <code>dashboards/checkout-overview.yaml</code>, a new file in the Perses format Dash0 dashboards use. ' +
          'Below is every line it adds, one key per line with its path from the top of the file. A layout item names its panel in <code>$ref</code>, and its <code>x</code>, <code>y</code>, <code>width</code> and <code>height</code> place it on the grid.',
        question: 'Which lines would you stop in review?',
        qid: 'dac-q-spot',
        spot: SPOT,
      },
      {
        intro:
          'The payments team runs on a managed container service with no Kubernetes cluster. Its cloud resources are described in Terraform and applied by the pipeline when a pull request merges. ' +
          'It wants its dashboards to go through the same review, and a dashboard exported from Dash0 is the same kind of YAML you just read.',
        question: 'How should payments\' dashboards reach Dash0?',
        qid: 'dac-q-deploy',
        choice: { id: 'dac-deploy', choices: DEPLOY },
      },
    ],
    finish:
      'A dashboard in git is reviewed like code: a reviewer reads what the pull request adds, before anything is live. Dash0 dashboards use the Perses format, so the same YAML is applied by the operator in a cluster or by Terraform without one.',
  },
};
