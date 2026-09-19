/**
 * The Meridian org: the eight teams already named by the manifests and the
 * packs, in two departments so the grouping is exercised rather than asserted.
 *
 * Deliberately NOT here: `risk-ops`, which one demo process is owned by. That
 * is the `unknown-team` defect — a team that was renamed, merged, or never
 * added, which is the situation the registry exists to catch.
 */

export const DEPARTMENTS = [
  {
    id: 'trading-platform',
    name: 'Trading Platform',
    description: 'Everything a customer does with their money, from signing up to settling a trade.',
  },
  {
    id: 'data-and-growth',
    name: 'Data and Growth',
    description: 'What the platform knows about itself, and how it talks to customers.',
  },
]

export const TEAMS = [
  {
    id: 'platform',
    name: 'Platform',
    department: 'trading-platform',
    description: 'The public edge: the gateway, sessions, routing and rate limiting. Owns no business logic of its own.',
    contact: '#meridian-platform',
  },
  {
    id: 'identity',
    name: 'Identity',
    department: 'trading-platform',
    description: 'Who the customer is and what they are allowed to do — registration, documents, KYC and the trading permission every order is checked against.',
    contact: '#meridian-identity',
  },
  {
    id: 'wallet',
    name: 'Wallet',
    department: 'trading-platform',
    description: 'Customer balances and holdings. The authority on whether a trade can be afforded, and the source of every balance figure shown anywhere.',
    contact: '#meridian-wallet',
  },
  {
    id: 'trading',
    name: 'Trading',
    department: 'trading-platform',
    description: 'Quotes, orders, matching and the price feed. The largest surface in the estate and the one most other teams depend on.',
    contact: '#meridian-trading',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    department: 'trading-platform',
    description: 'The book of record. Every movement of money or asset ends here, and nothing else may write to it.',
    contact: '#meridian-ledger',
  },
  {
    id: 'payments',
    name: 'Payments',
    department: 'trading-platform',
    description: 'Money in and money out: cards, bank transfers and the reconciliation against what the provider says happened.',
    contact: '#meridian-payments',
  },
  {
    id: 'data',
    name: 'Data',
    department: 'data-and-growth',
    description: 'The warehouse and everything built on it — the loaders, the reconciliation against the ledger, reports and statements.',
    contact: '#meridian-data',
  },
  {
    id: 'growth',
    name: 'Growth',
    department: 'data-and-growth',
    description: 'How the platform talks to customers: notifications, email and the templates behind them.',
    contact: '#meridian-growth',
  },
]

export const buildRegistry = () => ({
  departments: DEPARTMENTS,
  teams: TEAMS,
})
