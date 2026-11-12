// Level 5.6: Distributions. The player says what happens when a config names a component the
// Collector binary does not contain, sorts nine components into the pre-built distributions that ship
// them (core, contrib and k8s; contrib and k8s but not core; contrib only; none), and says how to get a
// component nobody ships: build a custom distribution with OCB, the OpenTelemetry Collector Builder.
// Spec: docs/OUTLINE.md §4 Act 5.
// Spec: https://opentelemetry.io/docs/collector/distributions/ , https://opentelemetry.io/docs/collector/extend/ocb/ , https://opentelemetry.io/docs/collector/components/processor/
// Docs (GitHub, not an allowed Spec host): https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol/manifest.yaml , https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol-contrib/manifest.yaml , https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol-k8s/manifest.yaml , https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol-k8s/README.md , https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol-contrib/README.md
//
// Docs (exporter type names, Collector v0.164.0): https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlpexporter/metadata.yaml , https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlphttpexporter/metadata.yaml
//
// What is taught is the part that does not change: a distribution is a fixed set of components
// compiled into one binary, and a config can only use what is in it. The items are components whose
// distribution list is the same on their README, on the processors, receivers and exporters pages of
// the docs and in the manifests (v0.164.0): batch, memory_limiter and the otlp_grpc exporter (core,
// contrib, k8s); k8sattributes, redaction and tail_sampling (contrib, k8s); the awss3 and awsxray
// exporters (contrib only). The core distribution has been gaining components (transform, filter and
// attributes are in its manifest while some component pages still list contrib and k8s), and the
// otlp and eBPF profiling distributions ship little, so no item depends on those, and the copy tells the
// player to read the manifest.

// Step 1: a config names a component the binary does not have. `why` follows "Right." or "Not quite.".
const UNKNOWN = [
  {
    key: 'ignored',
    label: 'It starts, and the pipeline that lists <code>k8sattributes</code> just passes the data through unchanged',
    why: 'The Collector checks every component id in the config against the components compiled into the binary. A component it does not have is an error, not something to skip.',
  },
  {
    key: 'refuses-to-start',
    label: 'The Collector refuses to start with an unknown type error: <code>k8sattributes</code> is not compiled into the core distribution',
    right: true,
    why: 'A distribution is a set of components compiled into one binary. <code>k8sattributes</code> is in the contrib and k8s distributions, not in core, so the core binary has no processor of that type and the config is rejected at startup.',
  },
  {
    key: 'loads-on-demand',
    label: 'It starts, and downloads the processor from the contrib repository the first time a pipeline needs it',
    why: 'The Collector does not fetch components at run time. Everything it can run is compiled in, so a missing one means a different distribution or a custom build.',
  },
];

const BUCKETS = [
  { id: 'all-three', label: 'Core, contrib and k8s' },
  { id: 'contrib-k8s', label: 'Contrib and k8s, not core' },
  { id: 'contrib-only', label: 'Contrib only' },
  { id: 'none', label: 'None of them' },
];

// Step 2: nine components, interleaved. `whyNot` has one line for each of the other three buckets.
const SORT = {
  id: 'dist-sort',
  helps: { hints: false },
  buckets: BUCKETS,
  items: [
    {
      id: 'k8sattributes',
      label: 'k8sattributes (processor)',
      bucket: 'contrib-k8s',
      why: 'It is in the contrib distribution and in k8s, which is made for running in a cluster, but not core.',
      whyNot: {
        'all-three': 'The core distribution does not ship it. Its Distributions row lists contrib and k8s only.',
        'contrib-only': 'The k8s distribution is for monitoring Kubernetes, and enriching telemetry with pod metadata is what it is for, so it ships it too.',
        none: 'Two of the pre-built distributions ship it, so no custom build is needed.',
      },
    },
    {
      id: 'batch',
      label: 'batch (processor)',
      bucket: 'all-three',
      why: 'It is part of the core distribution, so it is in contrib and k8s as well.',
      whyNot: {
        'contrib-k8s': 'It is in core too, so it is not limited to contrib and k8s.',
        'contrib-only': 'It is in core and k8s as well as contrib.',
        none: 'The pre-built distributions ship it, core included.',
      },
    },
    {
      id: 'awss3-exporter',
      label: 'awss3 (exporter)',
      bucket: 'contrib-only',
      why: 'A vendor exporter: only the contrib distribution ships it.',
      whyNot: {
        'all-three': 'The core distribution has a short exporter list (otlp_grpc, debug, file and a few more), and this is not on it.',
        'contrib-k8s': 'The k8s distribution ships a short list of exporters (otlp_grpc, otlp_http, otelarrow, load_balancing, nop, debug and file), so a vendor exporter is not in it.',
        none: 'The contrib distribution ships it, so it is not a custom build.',
      },
    },
    {
      id: 'memory-limiter',
      label: 'memory_limiter (processor)',
      bucket: 'all-three',
      why: 'It is part of the core distribution, so it is in contrib and k8s as well.',
      whyNot: {
        'contrib-k8s': 'It is in core too, so it is not limited to contrib and k8s.',
        'contrib-only': 'It is in core and k8s as well as contrib.',
        none: 'The pre-built distributions ship it, core included.',
      },
    },
    {
      id: 'redaction',
      label: 'redaction (processor)',
      bucket: 'contrib-k8s',
      why: 'It is in contrib and k8s, but not core: the processor that masks PII is not in the core distribution.',
      whyNot: {
        'all-three': 'The core distribution does not ship it. Its Distributions row lists contrib and k8s.',
        'contrib-only': 'The k8s distribution ships it too, so it is not contrib only.',
        none: 'Two of the pre-built distributions ship it, so no custom build is needed.',
      },
    },
    {
      id: 'acme-scrubber',
      label: 'acme_scrubber (a processor your team wrote in Go)',
      bucket: 'none',
      why: 'No pre-built distribution can contain a component the project has never heard of. To run it, build a distribution with OCB that includes it.',
      whyNot: {
        'all-three': 'The project builds these distributions from its own repositories. A component your team wrote is not in them.',
        'contrib-k8s': 'The k8s distribution only includes components from core and contrib, and this is in neither.',
        'contrib-only': 'The contrib distribution only includes components from the Collector repositories, and this is in neither.',
      },
    },
    {
      id: 'tail-sampling',
      label: 'tail_sampling (processor)',
      bucket: 'contrib-k8s',
      why: 'It is in contrib and k8s, but not core.',
      whyNot: {
        'all-three': 'The core distribution does not ship it. Its Distributions row lists contrib and k8s.',
        'contrib-only': 'The k8s distribution ships it too, so it is not contrib only.',
        none: 'Two of the pre-built distributions ship it, so no custom build is needed.',
      },
    },
    {
      id: 'otlp-exporter',
      label: 'otlp_grpc (exporter)',
      bucket: 'all-three',
      why: 'The OTLP exporter is in core, so contrib and k8s have it too (the otlp distribution ships it as well).',
      whyNot: {
        'contrib-k8s': 'It is in core too, so it is not limited to contrib and k8s.',
        'contrib-only': 'It is in core and k8s as well as contrib.',
        none: 'The pre-built distributions ship it, core included.',
      },
    },
    {
      id: 'awsxray-exporter',
      label: 'awsxray (exporter)',
      bucket: 'contrib-only',
      why: 'A vendor exporter: only the contrib distribution ships it.',
      whyNot: {
        'all-three': 'The core distribution has a short exporter list (otlp_grpc, debug, file and a few more), and this is not on it.',
        'contrib-k8s': 'The k8s distribution ships a short list of exporters (otlp_grpc, otlp_http, otelarrow, load_balancing, nop, debug and file), so a vendor exporter is not in it.',
        none: 'The contrib distribution ships it, so it is not a custom build.',
      },
    },
  ],
};

// Step 3: how to get a component nobody ships. `why` follows "Right." or "Not quite.".
const BUILD = [
  {
    key: 'contrib-config',
    label: 'Run the contrib distribution and list <code>acme_scrubber</code> in the config: contrib ships every component, and it is already there',
    why: 'The contrib distribution holds the components of the Collector repositories, not every component that exists. A config can only enable what is compiled in, and your processor is not.',
  },
  {
    key: 'ocb',
    label: 'Build a custom distribution with OCB, the OpenTelemetry Collector Builder: list your processor in a manifest',
    right: true,
    why: 'ocb takes a manifest that lists the components to include, yours among them, and builds a Collector binary with exactly those. The same tool gives you a smaller binary and a smaller attack surface than contrib, which the contrib README suggests for production.',
  },
  {
    key: 'otlp-distro',
    label: 'Use the otlp distribution: it is made for custom processors, and loads them by name at startup',
    why: 'The otlp distribution is a minimal one, with the OTLP receiver and exporters. It has no way to load your processor either: you need a build that compiles it in.',
  },
];

export default {
  id: 'distributions',
  no: '5.6',
  name: 'Distributions',
  sub: 'What ships where',
  icon: '\u{1F4E6}',
  rewardTitle: 'Distro whisperer',
  cards: ['not-every-component'],
  lights: ['collector'],
  scoring: { parMs: null },
  play: {
    prefix: 'dist',
    steps: [
      {
        intro:
          'The project publishes pre-built Collector <b>distributions</b>: core, contrib, k8s, otlp and one for eBPF profiling. A distribution is a fixed set of ' +
          'components compiled into one binary, listed in its <code>manifest.yaml</code>. The platform team copied a config that uses ' +
          '<code>k8sattributes</code> from a cluster running contrib and deployed it on a laptop with the core distribution.',
        question: 'What happens?',
        qid: 'dist-q-unknown',
        choice: { id: 'dist-unknown', choices: UNKNOWN },
      },
      {
        intro:
          'Not every component is in every distribution. The Distributions row on a component\'s page, and the manifests, say where it ships. ' +
          'Sort these into the pre-built distributions that ship them. (The core list has grown over time, so the manifest is the thing to read, not a copy.)',
        question: 'Which distributions ship each component?',
        qid: 'dist-q-sort',
        sort: SORT,
      },
      {
        intro:
          'Your team also wrote <code>acme_scrubber</code>, a processor that masks card numbers, and wants it in the Collector.',
        question: 'How do you get a Collector that contains it?',
        qid: 'dist-q-build',
        choice: { id: 'dist-build', choices: BUILD },
      },
    ],
    finish:
      'You know a Collector can only run what is compiled into it: check the manifest, and when no distribution has your component, build your own with OCB.',
  },
};
