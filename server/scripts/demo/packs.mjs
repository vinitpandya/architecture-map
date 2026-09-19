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
        handsOffTo: [
          { process: 'L1.1.3', note: 'Wallet opens the wallets off the new-customer event.' },
        ],
      },
      {
        code: '1.1.3',
        name: 'Open the wallets',
        owner: 'wallet',
        node: 'svc:wallet-service',
        interaction: on('svc:wallet-service', 'db.write', 'db:postgres/wallet'),
        touches: ['topic:users.created.v2'],
      },
      {
        code: '1.1.4',
        name: 'Start the session',
        owner: 'platform',
        node: 'svc:gateway-api',
        interaction: on('svc:gateway-api', 'cache.write', 'cache:redis/session'),
      },
      { code: '1.2', name: 'Verifying identity' },
      {
        code: '1.2.1',
        name: 'Record the verification result',
        // Deliberate: KYC decisioning moved to Risk and Controls and nobody
        // added them to teams.json, so this is the one `unknown-team`.
        owner: 'risk-ops',
        node: 'svc:identity-service',
        interaction: on('svc:identity-service', 'db.write', 'db:postgres/identity'),
      },
      {
        code: '1.2.2',
        name: 'Announce approval',
        node: 'svc:identity-service',
        interaction: on('svc:identity-service', 'kafka.produce', 'topic:kyc.approved.v1'),
        handsOffTo: [
          { process: 'L1.2.3', note: 'Wallet picks the approval off the topic and lifts the trading block.' },
        ],
      },
      {
        code: '1.2.3',
        name: 'Enable trading on the wallet',
        owner: 'wallet',
        node: 'svc:wallet-service',
        interaction: on('svc:wallet-service', 'kafka.consume', 'topic:kyc.approved.v1'),
        // Deliberate: L4.1 is the risk team's monitoring process and no pack
        // declares it, so this is the one `process-link-unknown-target`. The
        // common real case — the team at the other end is not on the map yet.
        handsOffTo: [
          { process: 'L4.1', note: 'Risk starts monitoring the account once it can trade.' },
        ],
      },
      { code: '1.3', name: 'Funding the account', owner: 'payments' },
      {
        code: '1.3.1',
        owner: 'payments',
        name: 'Take the card payment',
        node: 'svc:payments-service',
        interaction: on('svc:payments-service', 'http.call', 'ext:stripe'),
      },
      {
        code: '1.3.2',
        owner: 'payments',
        name: 'Record the payment',
        node: 'svc:payments-service',
        interaction: on('svc:payments-service', 'db.write', 'db:postgres/payments'),
        // Deliberate: payments used to notify the customer itself, before the
        // balance-change event existed. The two processes now share no
        // component at all, so this is the one `process-link-unsupported` — a
        // handoff that was real and was replaced, with the document left behind.
        handsOffTo: [
          { process: 'L2.4.2', note: 'Payments asks notification-service to confirm the deposit.' },
        ],
      },
      {
        code: '1.3.3',
        owner: 'payments',
        name: 'Announce the settled payment',
        node: 'svc:payments-service',
        interaction: on('svc:payments-service', 'kafka.produce', 'topic:payments.settled.v1'),
        handsOffTo: [
          { process: 'L1.3.4', note: 'The ledger posts the deposit from the settled-payment event.' },
        ],
      },
      {
        code: '1.3.4',
        name: 'Post the deposit to the ledger',
        owner: 'ledger',
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
      // Over a year old on purpose: this is the pack that describes a topic
      // which no longer exists and a call nobody makes, and a document in that
      // state should look like one nobody has checked.
      asOf: '2025-06-19',
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
        owner: 'platform',
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

export const PROSE = {
    "onboarding": {
      "description": "How a customer opens an account, is verified, and gets money onto the platform — the account record, the wallets, the session, the KYC decision and card funding. It stops where trading starts: pricing an order, placing it and settling it belong to order-and-execution. It does not cover withdrawals, refunds, chargebacks or any other reversal of a settled payment, closing an account, or how the verification provider reaches its decision, which happens outside the platform entirely.",
      "processes": {
        "1": {
          "description": "A person becomes a customer the platform is allowed to do business with, and money they have paid in is recorded against them. The three stages are deliberately separable rather than one transaction: an account can exist unverified, and a verified account can sit empty, so nothing downstream may assume all three are true because one of them is.",
          "trigger": "Someone completes the signup form in the app.",
          "outcome": "A verified customer whose card payment has been captured and posted to the ledger, with the holds that signup placed now lifted.",
          "tags": [
            "customer-facing",
            "regulated"
          ]
        },
        "1.1": {
          "description": "Everything that has to exist before the customer can do anything at all. None of it waits for verification — the account opens unverified, and the wallets it creates can take a deposit but not pay one out. The customer record, the wallets and the session are written by three different services, one of them off an event rather than a call, so nothing covers signup as a single transaction: a customer with a record and no wallets is the ordinary partial state, and the first symptom is a deposit with nowhere to land.",
          "outcome": "A customer record in the pending KYC state, a wallet per supported asset, and a session the customer is already logged in to."
        },
        "1.1.1": {
          "description": "The KYC state starts at pending on this row, and it is the copy a service reads when it asks identity directly — the order service checks it before it will price anything. It is not what releases the wallet's holds; the approval event in 1.2.2 does that. The email address is the uniqueness constraint, so a resubmitted signup fails here rather than quietly producing a second customer with a second set of wallets."
        },
        "1.1.2": {
          "description": "One event, three independent consumers: the wallets are opened, the welcome mail goes out, and payments creates its own customer record ahead of the first card being used. None of the three are coordinated and none acknowledge anything back, so identity treats the publish as done the moment the broker accepts it. A consumer that is simply down loses nothing — it resumes from its offset and the wallets appear late — but one that takes the event and fails to process it loses that signup outright, because there is no dead-letter path and nothing reconciles the three afterwards. The row in 1.1.1 is committed and then this event is published, as two operations rather than one, so a crash in between leaves a customer who exists with no wallets and no event that will ever be redelivered."
        },
        "1.1.3": {
          "description": "One wallet per supported asset, all at zero and all opened with the withdrawal hold that only verification lifts. They are created from the customer event rather than by a call from identity, so there is a short window after signup in which the customer exists and has nowhere to put money. Creation is keyed on the customer and the asset, so a redelivered event opens nothing a second time."
        },
        "1.2": {
          "description": "Turning a registered account into one the platform may legally trade and pay out from. A rejection, or a request for further documents, travels the same path as an approval and is recorded the same way — it simply never produces the event that lifts the holds, so \"not yet verified\" and \"rejected\" look identical to every service except identity. Approval only ever lifts holds; nothing here re-applies them, so freezing an account afterwards — a sanctions hit, expired documents, a failed re-check — does not travel this path at all.",
          "trigger": "The verification provider returns a decision on the documents the customer submitted.",
          "outcome": "The customer record carries a decision, and on an approval the holds placed at signup are lifted."
        },
        "1.2.1": {
          "description": "Updates the KYC state on the record 1.1.1 created — the same table, minutes or days later, on a callback from a third-party verification provider the platform does not operate. Last write wins on the row, so a later decision can take an approved customer back to rejected, and every approval publishes 1.2.2 again, which is why 1.2.3 has to be safe to apply twice. Nothing orders the callbacks, and the row keeps only the current decision, so the history an audit of why a customer was approved would want is not in identity."
        },
        "1.2.2": {
          "description": "Only approvals are published; a rejection stays inside identity. The event, not the field, is what clears the wallet's withdrawal hold, and the order service takes it into its own copy of the state. A customer whose record reads approved while the event was never delivered therefore passes the pre-trade check, which reads identity directly, and is refused only when they try to take money out — a far more confusing failure than being refused outright.",
          "optional": true
        },
        "1.2.3": {
          "description": "The hold this lifts is on withdrawals, not on trading: until the event arrives a customer can pay money in and cannot take it out, and whether they may trade is decided by the order service, which consumes the same event into its own copy. Approval therefore takes effect in two places independently and can be live in one before the other. Deposits are accepted before verification completes, so a customer who is then refused is left holding money they cannot withdraw, and returning it to the card it came from is a manual job no component here performs."
        },
        "1.3": {
          "description": "Getting real money onto the platform and making it countable. The card clearing and the books recording a deposit are two separate facts that become true at different moments, and the gap between them is where funding goes wrong: a customer whose card has been charged but whose posting has not happened has money that is visible only inside payments, and nowhere a customer, a support agent or the books would look. A captured payment is not final either — a chargeback or a refund reverses it weeks later, by which time the money may have been traded away, and nothing here consumes or emits a reversal.",
          "trigger": "The customer enters a card and an amount.",
          "outcome": "The card has been captured and a matching pair of ledger postings exists for it."
        },
        "1.3.1": {
          "description": "Authorisation and capture happen in the one call; there is no separate capture to wait for. The idempotency key is generated before the call and sent with it, which is what makes a timeout survivable — the charge may well have succeeded, so the same call is reissued with the same key rather than sent as a new payment. The reference the provider returns is a different key, and it is the one 1.3.3 publishes and 1.3.4 posts against. An authorisation that comes back needing a 3-D Secure challenge captures nothing until the customer completes it, and an abandoned challenge is the commonest way a funding attempt ends with no money moved and nobody told."
        },
        "1.3.2": {
          "description": "Stores the provider's reference under a unique constraint — that constraint, not the code around it, is what makes a settlement impossible to post twice. It is written before 1.3.3 announces anything, so a crash in between leaves a cleared payment that can be republished rather than a posting with no payment behind it. A crash before it, between the provider answering and this write, is the worse one: the customer has been charged and the platform holds no record of it, so it surfaces only against the provider's own statement."
        },
        "1.3.3": {
          "description": "Published on capture, never on authorisation: the customer's card has been charged, though the acquirer does not pay the money over for another day or two and the platform carries that exposure in between. An authorised-but-uncaptured payment that is later abandoned would otherwise be credited to a customer who never paid, and nothing downstream can tell the difference after the fact. Payments also raises a notification request off the back of funding, which is how the customer learns the deposit landed."
        },
        "1.3.4": {
          "description": "Two legs in one transaction — the platform's cash at the provider against the customer's balance as a liability — keyed on the provider's payment reference, so a settlement redelivered after a consumer restart posts nothing a second time. Without that key a duplicate posts the deposit twice, overstating the customer's ledger balance and the platform's liability, and nothing compares the ledger against the provider's own statement; reconciliation runs the warehouse against the ledger instead, so a double posting reconciles perfectly and stays wrong. The customer is credited the amount they entered, with the provider's fee coming out of what it pays over and booked as the platform's cost, so these two legs are not the whole entry. The customer's visible wallet balance does not move on this event."
        }
      }
    },
    "reporting": {
      "description": "How the data team turns the platform's event stream into the trade and balance warehouse, and how a customer or an operator gets a report or a statement back out of it. It covers the loaders, the reconciliation against the ledger, the report index and the retrieval path that runs through reporting-service. It does not cover report search, which the gateway serves straight off the index without coming through this service; the price tick feed reporting-service also consumes, which values holdings and is the trading team's to document; the ledger itself, which is the book of record; or the regulatory submissions built on top of the warehouse, which are assembled by hand outside anything in this map.",
      "processes": {
        "3": {
          "description": "Everything the platform did is put somewhere it can be asked about afterwards: a customer can see what they traded and what they hold, and the business can answer an auditor without going back to the services that did the work. Nothing here is a source of truth. Every figure in the warehouse is a copy of something another team owns, and where a copy and its origin disagree the origin wins.",
          "trigger": "Nothing starts it — the loaders run continuously, a few minutes behind the platform, and a report can be asked for at any time.",
          "outcome": "The warehouse ties to the ledger for the period, and a customer or an operator can retrieve a report that reflects it.",
          "tags": [
            "customer-facing",
            "regulated"
          ]
        },
        "3.1": {
          "description": "Turning the event stream into rows that can be queried, and then proving that the rows match the book. The loaders sit deliberately behind the platform rather than beside it — everything is written in batches, so anything that has to be current is asked of the service that owns it instead of read from here.",
          "trigger": "A trade or a balance movement is published.",
          "outcome": "The warehouse holds the period's trades and closing balances, reconciled against the ledger."
        },
        "3.1.1": {
          "description": "Takes fills from the enrichment stream rather than the raw one, so a trade arrives already carrying the trading pair, the fee and the customer on each side, and the loader never has to join back to the trading databases to make a row readable. trades.enriched.v1 is published by trading's enrichment job, not by anything the data team runs. Both loads land on the same fact_trade row, keyed on the fill id: the raw load writes it and this one fills in the columns that arrive a few seconds later. If the stream goes quiet the warehouse loses those columns, not rows.",
          "notes": "Raised at a review last year that the matching engine now puts these fields on the fill itself, and that the enrichment stage may no longer be separate. Left as written pending a decision from the trading team, who owned the enrichment job."
        },
        "3.1.2": {
          "description": "The fill carries price, quantity and both sides, so a trade row is built from the event alone. Keyed on the fill id, so a redelivered event is a no-op rather than a second row — without that key a partition rebalance would double the day's volume and nobody would find out until reconciliation. A large order fills in parts and produces several events under one order id, so counting these events counts fills, not orders."
        },
        "3.1.3": {
          "description": "The event carries the balance after the movement, not the delta, so the warehouse keeps the last event per wallet, per asset, per day and never sums them; a redelivered one rewrites the same figure rather than double-counting it. A missed event dates a closing figure rather than corrupting it, and the next event puts that wallet right from then on — it never corrects a period already reported, which is what 3.1.5 is for."
        },
        "3.1.4": {
          "description": "Written in batches every few minutes rather than per event. A row's window comes from the event's own timestamp, not from when the batch ran, so replaying a topic from an earlier offset rebuilds the same windows with the same rows: a bad day is fixed by replaying offsets, not by patching rows."
        },
        "3.1.5": {
          "actor": "scheduled job",
          "description": "A mismatch in the day's totals is a fault in the load, not a correction to the book: the fix is to reload the window rather than adjust the warehouse — unless the ledger is holding the posting against a flagged transaction, which ties when the hold lifts and is not hurried by a reload. Postings come through the ledger's API; the schema is read directly for what will not come that way, and the job keeps its own checkpoint row in there, so a table this team owns sits inside a database the ledger team owns. A schema change there breaks the reconciliation overnight, with no signal to the ledger team that anyone was reading."
        },
        "3.2": {
          "description": "Getting a built report to whoever asked for it — statements, trade histories and the operator's period reports. They are generated ahead of the request wherever their shape allows it, so this stage is mostly retrieval rather than computation: a request that finds nothing built answers not-ready instead of blocking while it is produced.",
          "trigger": "A customer opens a statement, or an operator asks for a report.",
          "outcome": "The requester has the report, or a clear answer that it is not ready yet."
        },
        "3.2.1": {
          "description": "Gateway-api queries this index directly rather than coming through reporting-service, so the ownership filter on search results is the gateway's to apply and not this service's, and anything written here is reachable by whoever the gateway lets search. The index is derived: a lost one is rebuilt from the warehouse, not restored."
        },
        "3.2.2": {
          "actor": "customer",
          "description": "The gateway holds the customer session and resolves the report id to its owner from the search index before forwarding. Reporting-service trusts the customer id it is handed and does not re-check ownership itself, so this endpoint must never be reachable except through the gateway. A report that has not been built yet answers not-found rather than an empty one, so the app can tell 'not ready' from 'nothing happened in that period'."
        },
        "3.2.3": {
          "optional": true,
          "description": "Statements only. The closing figure in the footer is read from the wallet as the customer opens the statement, not taken from the copy the loader wrote: the one figure on a statement that is not pre-built, so a customer with the statement open and the app open sees the same number in both places. Everything else is as at the end of the period. If the wallet does not answer, the footer falls back to the warehouse figure and the statement still renders. Nobody has re-confirmed this since statement generation moved onto the warehouse loader.",
          "notes": "Argued for when statements were designed: a customer comparing the footer against the app and finding two different numbers raises a ticket every time, and that was judged worse than one extra call per wallet on the render."
        }
      }
    }
  }

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
        owner: prose.owner ?? p.owner ?? s.owner,
        actor: prose.actor,
        trigger: prose.trigger,
        outcome: prose.outcome,
        node: p.node,
        interaction: p.interaction,
        touches: p.touches,
        handsOffTo: p.handsOffTo,
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
