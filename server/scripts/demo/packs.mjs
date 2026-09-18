/**
 * The Meridian demo process packs (SPEC-PROCESSES §11), as data.
 *
 * Three packs over the estate in estate.mjs. `order-and-execution` is
 * `schema/example.order-and-execution.json` verbatim — it is the Phase 7
 * fixture and stays clean, so it is copied rather than rewritten here.
 *
 * The other two are built from a skeleton and a block of prose. The skeleton
 * is the structure — codes, names, and the component and interaction each
 * process binds to — and every interaction in it resolves against the seeded
 * estate except the two the spec asks for:
 *
 *   3.1.1  consumes a topic that does not exist       → process-missing-component
 *   3.2.3  makes a call that exists in no repository  → process-missing-interaction
 *
 * Those two are the demonstration of why Layer B is worth having: one document
 * naming a component that is gone, one naming a call that was never made.
 * Nothing else in the demo is allowed to be unresolved, because the §10
 * verification asserts exactly one of each.
 */

import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from '../../src/config.js'

const PROMPT_VERSION = '2026-09-18b'

/** `svc:x http.call api:y` written the short way, since every one has a from. */
const on = (from, kind, to) => ({ from, kind, to })

/* ───────────────────────────────────────────────────────────── skeletons */

export const SKELETONS = [
  {
    pack: 'onboarding',
    name: 'Onboarding and funding',
    owner: 'identity',
    authoredAt: '2026-09-17T15:30:00Z',
    source: {
      kind: 'confluence',
      url: 'https://meridian.atlassian.net/wiki/spaces/ID/pages/204/Onboarding+and+funding',
      title: 'Onboarding and funding — process map',
      owner: 'identity',
      asOf: '2026-08-14',
    },
    processes: [
      { code: '1', name: 'Onboarding and funding' },
      { code: '1.1', name: 'Opening an account' },
      {
        code: '1.1.1',
        name: 'Create the customer record',
        node: 'svc:identity-service',
        interaction: on('svc:identity-service', 'db.write', 'db:postgres/identity'),
      },
      {
        code: '1.1.2',
        name: 'Announce the new customer',
        node: 'svc:identity-service',
        interaction: on('svc:identity-service', 'kafka.produce', 'topic:users.created.v2'),
      },
      {
        code: '1.1.3',
        name: 'Open the wallets',
        node: 'svc:wallet-service',
        interaction: on('svc:wallet-service', 'db.write', 'db:postgres/wallet'),
        touches: ['topic:users.created.v2'],
      },
      {
        code: '1.1.4',
        name: 'Start the session',
        node: 'svc:gateway-api',
        interaction: on('svc:gateway-api', 'cache.write', 'cache:redis/session'),
      },
      { code: '1.2', name: 'Verifying identity' },
      {
        code: '1.2.1',
        name: 'Record the verification result',
        node: 'svc:identity-service',
        interaction: on('svc:identity-service', 'db.write', 'db:postgres/identity'),
      },
      {
        code: '1.2.2',
        name: 'Announce approval',
        node: 'svc:identity-service',
        interaction: on('svc:identity-service', 'kafka.produce', 'topic:kyc.approved.v1'),
      },
      {
        code: '1.2.3',
        name: 'Enable trading on the wallet',
        node: 'svc:wallet-service',
        interaction: on('svc:wallet-service', 'kafka.consume', 'topic:kyc.approved.v1'),
      },
      { code: '1.3', name: 'Funding the account' },
      {
        code: '1.3.1',
        name: 'Take the card payment',
        node: 'svc:payments-service',
        interaction: on('svc:payments-service', 'http.call', 'ext:stripe'),
      },
      {
        code: '1.3.2',
        name: 'Record the payment',
        node: 'svc:payments-service',
        interaction: on('svc:payments-service', 'db.write', 'db:postgres/payments'),
      },
      {
        code: '1.3.3',
        name: 'Announce the settled payment',
        node: 'svc:payments-service',
        interaction: on('svc:payments-service', 'kafka.produce', 'topic:payments.settled.v1'),
      },
      {
        code: '1.3.4',
        name: 'Post the deposit to the ledger',
        node: 'svc:ledger-service',
        interaction: on('svc:ledger-service', 'kafka.consume', 'topic:payments.settled.v1'),
        touches: ['db:postgres/ledger'],
      },
    ],
  },

  {
    pack: 'reporting',
    name: 'Reporting',
    owner: 'data',
    authoredAt: '2026-09-16T09:45:00Z',
    source: {
      kind: 'confluence',
      url: 'https://meridian.atlassian.net/wiki/spaces/DATA/pages/311/Reporting',
      title: 'Reporting — how the warehouse is built',
      owner: 'data',
      asOf: '2025-11-03',
    },
    processes: [
      { code: '3', name: 'Reporting' },
      { code: '3.1', name: 'Building the read models' },
      {
        code: '3.1.1',
        name: 'Enrich matched trades',
        node: 'svc:reporting-service',
        // Deliberate: this topic is in no manifest. The enrichment step was
        // folded into the matching engine and the document never caught up.
        interaction: on('svc:reporting-service', 'kafka.consume', 'topic:trades.enriched.v1'),
      },
      {
        code: '3.1.2',
        name: 'Ingest matched trades',
        node: 'svc:reporting-service',
        interaction: on('svc:reporting-service', 'kafka.consume', 'topic:orders.matched.v1'),
      },
      {
        code: '3.1.3',
        name: 'Ingest balance changes',
        node: 'svc:reporting-service',
        interaction: on('svc:reporting-service', 'kafka.consume', 'topic:wallet.balance.changed.v1'),
      },
      {
        code: '3.1.4',
        name: 'Write the warehouse',
        node: 'svc:reporting-service',
        interaction: on('svc:reporting-service', 'db.write', 'db:postgres/reporting'),
      },
      {
        code: '3.1.5',
        name: 'Reconcile against the ledger',
        node: 'svc:reporting-service',
        interaction: on('svc:reporting-service', 'db.read', 'db:postgres/ledger'),
      },
      { code: '3.2', name: 'Serving reports' },
      {
        code: '3.2.1',
        name: 'Index the report',
        node: 'svc:reporting-service',
        interaction: on('svc:reporting-service', 'db.write', 'db:elasticsearch/search'),
      },
      {
        code: '3.2.2',
        name: 'Answer a report request',
        node: 'svc:gateway-api',
        interaction: on('svc:gateway-api', 'http.call', 'api:reporting-service/GET /v1/reports/{}'),
      },
      {
        code: '3.2.3',
        name: 'Look up live balances for the statement',
        node: 'svc:reporting-service',
        // Deliberate: both ends are real components and no repository makes
        // this call. Statements are built from the warehouse instead.
        interaction: on('svc:reporting-service', 'http.call', 'api:wallet-service/GET /v1/wallets/{}/balance'),
      },
    ],
  },
]

/* ──────────────────────────────────────────────────────────────── prose

   Kept apart from the skeleton on purpose: the structure is what the
   verification asserts, and the prose is what the screens are designed
   against. Lorem-grade text produces lorem-grade layout decisions, so these
   are written as a real team would have written them — including the two that
   describe things which stopped being true.
*/

export const PROSE = {}

/* ───────────────────────────────────────────────────────────── assembly */

export function buildPacks() {
  const example = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'schema', 'example.order-and-execution.json'), 'utf8')
  )

  const built = SKELETONS.map((s) => ({
    schemaVersion: 1,
    promptVersion: PROMPT_VERSION,
    pack: s.pack,
    name: s.name,
    description: PROSE[s.pack]?.description,
    authoredAt: s.authoredAt,
    // Honest about provenance, as the demo manifests are: these come out of
    // the generator in this repository, not out of anybody's Confluence.
    producer: { kind: 'import', tool: 'seed-demo/1' },
    source: s.source,
    processes: s.processes.map((p) => {
      const prose = PROSE[s.pack]?.processes?.[p.code] ?? {}
      const row = {
        code: p.code,
        name: p.name,
        description: prose.description,
        owner: prose.owner ?? s.owner,
        actor: prose.actor,
        trigger: prose.trigger,
        outcome: prose.outcome,
        node: p.node,
        interaction: p.interaction,
        touches: p.touches,
        optional: prose.optional,
        tags: prose.tags,
        notes: prose.notes,
      }
      for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k]
      return row
    }),
  }))

  return [example, ...built]
}

export const PACK_IDS = ['order-and-execution', ...SKELETONS.map((s) => s.pack)]
