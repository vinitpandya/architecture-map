/**
 * Meridian — the fictional trading estate of SPEC.md §12, as data.
 *
 * The real service repositories are not available to this build, so this is
 * what ingest, the link pass, drift detection and the map are actually
 * verified against. Every relationship in §12 appears here and the counts in
 * §14 are derived from it, so a change here is a change to the test suite.
 */

export const ORG = 'meridian'
export const EVENTS_ARTIFACT = 'com.meridian:platform-events'

/** Ingest order. First claim wins on ownership, so this order is the estate's. */
export const SERVICES = [
  {
    repo: 'gateway-api',
    id: 'svc:gateway-api',
    name: 'Gateway API',
    language: 'kotlin',
    team: 'platform',
    pkg: 'gateway',
    Class: 'Gateway',
    tags: ['public-facing'],
    description:
      'The single public entry point. Terminates customer sessions, fans requests out to the internal services and returns one aggregated response.',
  },
  {
    repo: 'identity-service',
    id: 'svc:identity-service',
    name: 'Identity Service',
    language: 'kotlin',
    team: 'identity',
    pkg: 'identity',
    Class: 'Identity',
    tags: ['pii'],
    description:
      'Owns the customer record and the KYC lifecycle. Publishes a user event on creation and on KYC approval, and serves the user lookup everything else reads.',
  },
  {
    repo: 'wallet-service',
    id: 'svc:wallet-service',
    name: 'Wallet Service',
    language: 'kotlin',
    team: 'wallet',
    pkg: 'wallet',
    Class: 'Wallet',
    description:
      'Holds customer balances per asset and publishes a balance-changed event whenever one moves. Opens wallets in response to user creation and KYC approval.',
  },
  {
    repo: 'order-service',
    id: 'svc:order-service',
    name: 'Order Service',
    language: 'kotlin',
    team: 'trading',
    pkg: 'order',
    Class: 'Order',
    description:
      'Accepts and validates customer orders, checks balance and price before admitting one, then hands it to the matching engine.',
  },
  {
    repo: 'matching-engine',
    id: 'svc:matching-engine',
    name: 'Matching Engine',
    language: 'java',
    team: 'trading',
    pkg: 'matching',
    Class: 'Matching',
    description:
      'Keeps the order book in memory and matches incoming orders against it. Deliberately has no database — the book is rebuilt from the topic on start.',
  },
  {
    repo: 'ledger-service',
    id: 'svc:ledger-service',
    name: 'Ledger Service',
    language: 'kotlin',
    team: 'ledger',
    pkg: 'ledger',
    Class: 'Ledger',
    tags: ['financial-record'],
    description:
      'The double-entry book of record. Posts every matched trade and settled payment, and serves postings for reconciliation.',
  },
  {
    repo: 'pricing-service',
    id: 'svc:pricing-service',
    name: 'Pricing Service',
    language: 'go',
    team: 'trading',
    pkg: 'pricing',
    Class: 'Pricing',
    description:
      'Pulls reference prices from the market data vendor, publishes a tick stream and serves the rate lookup used at order and payment time.',
  },
  {
    repo: 'payments-service',
    id: 'svc:payments-service',
    name: 'Payments Service',
    language: 'kotlin',
    team: 'payments',
    pkg: 'payments',
    Class: 'Payments',
    tags: ['pci'],
    description:
      'Authorises and captures card payments through the payment provider, and publishes a settled payment for the ledger to post.',
  },
  {
    repo: 'notification-service',
    id: 'svc:notification-service',
    name: 'Notification Service',
    language: 'typescript',
    team: 'growth',
    pkg: 'notification',
    Class: 'Notification',
    description:
      'Turns platform events into customer email and push. Subscribes to the events it can act on and consumes an explicit request topic for everything else.',
  },
  {
    repo: 'reporting-service',
    id: 'svc:reporting-service',
    name: 'Reporting Service',
    language: 'python',
    team: 'data',
    pkg: 'reporting',
    Class: 'Reporting',
    description:
      'Builds the trading and balance warehouse and the searchable report index. Reads from the event stream and, for reconciliation, straight out of the ledger database.',
  },
]

export const byRepo = (repo) => SERVICES.find((s) => s.repo === repo)

/* ───────────────────────────────────────────────────────────────── topics */

export const TOPICS = [
  {
    id: 'topic:users.created.v2',
    name: 'users.created.v2',
    description: 'A customer record has been created. Carries the identity, locale and the signup channel.',
    producers: ['identity-service'],
    consumers: ['wallet-service', 'payments-service', 'notification-service'],
    contract: 'contract:com.meridian.events.UserCreated',
  },
  {
    id: 'topic:kyc.approved.v1',
    name: 'kyc.approved.v1',
    description: 'A customer has passed identity verification and may now trade and withdraw.',
    producers: ['identity-service'],
    consumers: ['wallet-service', 'order-service'],
  },
  {
    id: 'topic:orders.placed.v1',
    name: 'orders.placed.v1',
    description: 'An order that passed validation and is admitted to the book.',
    producers: ['order-service'],
    consumers: ['matching-engine'],
    contract: 'contract:com.meridian.events.OrderPlaced',
  },
  {
    id: 'topic:orders.matched.v1',
    name: 'orders.matched.v1',
    description: 'A fill: two orders matched, with price, quantity and both sides.',
    producers: ['matching-engine'],
    consumers: ['ledger-service', 'reporting-service'],
    contract: 'contract:com.meridian.events.OrderMatched',
  },
  {
    id: 'topic:wallet.balance.changed.v1',
    name: 'wallet.balance.changed.v1',
    description: 'A balance moved, with the asset, the delta and the reason it moved.',
    producers: ['wallet-service'],
    consumers: ['notification-service', 'reporting-service'],
    contract: 'contract:com.meridian.events.BalanceChanged',
  },
  {
    id: 'topic:payments.settled.v1',
    name: 'payments.settled.v1',
    description: 'A card payment that has cleared and is ready to be posted to the ledger.',
    producers: ['payments-service'],
    consumers: ['ledger-service'],
    contract: 'contract:com.meridian.events.PaymentSettled',
  },
  {
    id: 'topic:prices.ticked.v1',
    name: 'prices.ticked.v1',
    description: 'Reference price tick per trading pair, emitted on every vendor update.',
    producers: ['pricing-service'],
    consumers: ['matching-engine', 'reporting-service'],
  },
  {
    id: 'topic:notifications.requested.v1',
    name: 'notifications.requested.v1',
    description: 'An explicit request to notify a customer, for the cases no domain event covers.',
    producers: ['order-service', 'payments-service'],
    consumers: ['notification-service'],
  },
  {
    id: 'topic:risk.flagged.v1',
    name: 'risk.flagged.v1',
    description:
      'A transaction the risk platform has flagged for review. Produced by a team outside this scan, which is why nothing here claims it.',
    producers: [],
    consumers: ['ledger-service'],
  },
]

/* ────────────────────────────────────────────────────────────── contracts */

export const CONTRACTS = [
  {
    id: 'contract:com.meridian.events.UserCreated',
    name: 'UserCreated',
    description: 'Event payload published when a customer record is created.',
  },
  {
    id: 'contract:com.meridian.events.OrderPlaced',
    name: 'OrderPlaced',
    description: 'Event payload for an order admitted to the book.',
  },
  {
    id: 'contract:com.meridian.events.OrderMatched',
    name: 'OrderMatched',
    description: 'Event payload for a fill, carrying both sides of the trade.',
  },
  {
    id: 'contract:com.meridian.events.PaymentSettled',
    name: 'PaymentSettled',
    description: 'Event payload published when a card payment clears.',
  },
  {
    id: 'contract:com.meridian.events.BalanceChanged',
    name: 'BalanceChanged',
    description: 'Event payload for a balance movement on one asset.',
  },
]

/**
 * Which services bind which contract, and at what version. Everything is on
 * 3.2.0 except reporting on 2.8.1 and notification on 3.0.0 — the skew the
 * whole contract_bindings table exists to surface.
 */
export const BINDINGS = {
  'identity-service': ['contract:com.meridian.events.UserCreated'],
  'wallet-service': ['contract:com.meridian.events.UserCreated', 'contract:com.meridian.events.BalanceChanged'],
  'order-service': ['contract:com.meridian.events.OrderPlaced'],
  'matching-engine': ['contract:com.meridian.events.OrderPlaced', 'contract:com.meridian.events.OrderMatched'],
  'ledger-service': ['contract:com.meridian.events.OrderMatched', 'contract:com.meridian.events.PaymentSettled'],
  'payments-service': ['contract:com.meridian.events.UserCreated', 'contract:com.meridian.events.PaymentSettled'],
  'notification-service': ['contract:com.meridian.events.UserCreated', 'contract:com.meridian.events.BalanceChanged'],
  'reporting-service': ['contract:com.meridian.events.OrderMatched', 'contract:com.meridian.events.BalanceChanged'],
}

export const VERSION = (repo) =>
  repo === 'reporting-service' ? '2.8.1' : repo === 'notification-service' ? '3.0.0' : '3.2.0'

/* ────────────────────────────────────────────────────────────── endpoints */

export const ENDPOINTS = [
  {
    id: 'api:identity-service/GET /v1/users/{}',
    name: 'GET /v1/users/{}',
    method: 'GET',
    path: '/v1/users/{}',
    description: 'The customer record by id.',
    exposedBy: 'identity-service',
    calledBy: ['gateway-api', 'order-service'],
    handler: 'v1/users/{userId}',
    purpose: 'Looks the customer up to check their trading status.',
  },
  {
    id: 'api:wallet-service/GET /v1/wallets/{}/balance',
    name: 'GET /v1/wallets/{}/balance',
    method: 'GET',
    path: '/v1/wallets/{}/balance',
    description: 'Current balance per asset for one wallet.',
    exposedBy: 'wallet-service',
    calledBy: ['gateway-api', 'order-service'],
    handler: 'v1/wallets/{walletId}/balance',
    purpose: 'Checks the customer can cover the order before admitting it.',
  },
  {
    id: 'api:pricing-service/GET /v1/rates/{}',
    name: 'GET /v1/rates/{}',
    method: 'GET',
    path: '/v1/rates/{}',
    description: 'Latest reference rate for one trading pair.',
    exposedBy: 'pricing-service',
    calledBy: ['payments-service', 'order-service'],
    handler: 'v1/rates/{symbol}',
    purpose: 'Fetches the rate used to value the request in the account currency.',
  },
  {
    id: 'api:order-service/POST /v1/orders',
    name: 'POST /v1/orders',
    method: 'POST',
    path: '/v1/orders',
    description: 'Submit an order.',
    exposedBy: 'order-service',
    calledBy: ['gateway-api'],
    handler: 'v1/orders',
    purpose: 'Forwards the customer order from the public API.',
  },
  {
    id: 'api:ledger-service/GET /v1/postings',
    name: 'GET /v1/postings',
    method: 'GET',
    path: '/v1/postings',
    description: 'Postings in a time window, for reconciliation.',
    exposedBy: 'ledger-service',
    calledBy: ['reporting-service'],
    handler: 'v1/postings',
    purpose: 'Pulls the postings the warehouse reconciles the event stream against.',
  },
  {
    id: 'api:reporting-service/GET /v1/reports/{}',
    name: 'GET /v1/reports/{}',
    method: 'GET',
    path: '/v1/reports/{}',
    description: 'One generated report by id.',
    exposedBy: 'reporting-service',
    calledBy: ['gateway-api'],
    handler: 'v1/reports/{report_id}',
    purpose: 'Serves a customer statement through the public API.',
  },
]

/* ────────────────────────────────────────────────── databases and caches */

export const DATABASES = [
  { id: 'db:postgres/identity', name: 'identity', engine: 'postgres', description: 'Customer records, KYC state and credentials.', owner: 'identity-service', table: 'customer' },
  { id: 'db:postgres/wallet', name: 'wallet', engine: 'postgres', description: 'Wallets and per-asset balances.', owner: 'wallet-service', table: 'wallet' },
  { id: 'db:postgres/orders', name: 'orders', engine: 'postgres', description: 'Submitted orders and their lifecycle.', owner: 'order-service', table: 'customer_order' },
  { id: 'db:postgres/ledger', name: 'ledger', engine: 'postgres', description: 'Double-entry accounts and postings.', owner: 'ledger-service', table: 'posting' },
  { id: 'db:postgres/pricing', name: 'pricing', engine: 'postgres', description: 'Instruments and the reference rate history.', owner: 'pricing-service', table: 'rate' },
  { id: 'db:postgres/payments', name: 'payments', engine: 'postgres', description: 'Payment intents, authorisations and captures.', owner: 'payments-service', table: 'payment_intent' },
  { id: 'db:postgres/reporting', name: 'reporting', engine: 'postgres', description: 'The trade and balance warehouse.', owner: 'reporting-service', table: 'fact_trade' },
  { id: 'db:elasticsearch/search', name: 'search', engine: 'elasticsearch', description: 'Report and statement search index.', owner: 'reporting-service', table: 'reports' },
]

/**
 * Access beyond the owner's own. The ledger pair is the shared-database
 * finding §12 asks the estate to contain: a second service keeping its own
 * bookkeeping table inside another team's schema. Gateway only reads the
 * search index, which is not a shared database and correctly stays silent.
 */
export const DB_ACCESS = [
  {
    repo: 'reporting-service',
    db: 'db:postgres/ledger',
    access: [
      {
        kind: 'db.read',
        description: 'Reads postings straight out of the ledger schema to reconcile the warehouse against the event stream.',
        file: 'app/exports/ledger_export.py',
        snippet: 'rows = ledger.execute(text("SELECT id, account, amount FROM posting WHERE id > :cursor"), {"cursor": cursor})',
      },
      {
        kind: 'db.write',
        description: 'Keeps its own export checkpoint table inside the ledger schema.',
        file: 'app/exports/ledger_export.py',
        snippet: 'ledger.execute(text("INSERT INTO reporting_checkpoint (job, last_id) VALUES (:job, :id) ON CONFLICT (job) DO UPDATE SET last_id = :id"), mark)',
      },
    ],
  },
  {
    repo: 'gateway-api',
    db: 'db:elasticsearch/search',
    access: [
      {
        kind: 'db.read',
        description: 'Serves report search straight from the index rather than going through reporting.',
        file: 'src/main/kotlin/com/meridian/gateway/search/ReportSearch.kt',
        snippet: 'client.search({ it.index("reports").query(query) }, Report::class.java)',
      },
    ],
  },
]

export const CACHES = [
  {
    id: 'cache:redis/session',
    name: 'session',
    engine: 'redis',
    description: 'Customer session tokens, 30 minute sliding TTL.',
    access: [
      { repo: 'gateway-api', kinds: ['cache.write'], description: 'Stores the session on login so later requests skip identity.' },
      { repo: 'identity-service', kinds: ['cache.read', 'cache.write'], description: 'Issues and revokes the session alongside the credential change.' },
    ],
  },
  {
    id: 'cache:redis/pricing-quotes',
    name: 'pricing-quotes',
    engine: 'redis',
    description: 'Last quote per trading pair, 30 second TTL.',
    access: [
      { repo: 'pricing-service', kinds: ['cache.write'], description: 'Caches each tick so the rate lookup does not hit the database.' },
      { repo: 'order-service', kinds: ['cache.read'], description: 'Reads the last quote to price an order without a round trip.' },
    ],
  },
]

/* ────────────────────────────────────────────────────────────── externals */

export const EXTERNALS = [
  {
    id: 'ext:stripe',
    name: 'Stripe',
    repo: 'payments-service',
    description: 'Card authorisation and capture provider.',
    base: 'https://api.stripe.com/v1',
    purpose: 'Authorises and captures the customer card payment.',
  },
  {
    id: 'ext:sendgrid',
    name: 'SendGrid',
    repo: 'notification-service',
    description: 'Transactional email provider.',
    base: 'https://api.sendgrid.com/v3',
    purpose: 'Delivers the customer email once a template has been rendered.',
  },
  {
    id: 'ext:coinmarketcap',
    name: 'CoinMarketCap',
    repo: 'pricing-service',
    description: 'Market data vendor for reference prices.',
    base: 'https://pro-api.coinmarketcap.com/v1',
    purpose: 'Polls the vendor for the reference prices the tick stream is built from.',
  },
]

/* ───────────────────────────────────────────────────────────── unresolved

   Exactly three, one each in payments, notification and reporting. Each is a
   real thing the scan could see happening and could not pin down, which is a
   first-class result and not a failure. */

export const UNRESOLVED = {
  'payments-service': [
    {
      expected: 'kafka.topic',
      raw: '"payments.dlq." + System.getenv("ENV")',
      reason: 'The dead-letter topic name is built at runtime from an environment variable with no default in the repo.',
      file: 'src/main/kotlin/com/meridian/payments/kafka/DeadLetter.kt',
      snippet: 'val dlq = "payments.dlq." + System.getenv("ENV")',
    },
  ],
  'notification-service': [
    {
      expected: 'endpoint',
      raw: 'process.env.TEMPLATE_SERVICE_URL',
      reason: 'The template service base URL comes from an environment variable that is set outside the repository.',
      file: 'src/providers/templates.ts',
      snippet: "const base = process.env.TEMPLATE_SERVICE_URL ?? throwMissing('TEMPLATE_SERVICE_URL')",
    },
  ],
  'reporting-service': [
    {
      expected: 'database',
      raw: 'f"reports-{tenant}-{period}"',
      reason: 'The search index name is composed per tenant and period at call time, so the concrete indices are not visible in the source.',
      file: 'app/search/index.py',
      snippet: 'index = f"reports-{tenant}-{period}"',
    },
  ],
}
