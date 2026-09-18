# Architecture Map — Layer B: business processes

**Build specification, phases 7–11.** Extends [SPEC.md](SPEC.md), which is
complete and verified. Read this whole file before writing code, then work
through §9 Build order, verifying each phase against §10.

The three standing rules from SPEC.md §0 still apply: you have no access to the
real repositories, you follow the spec where it speaks and record your own call
in `DECISIONS.md` where it does not, and you never invent data to make a screen
look full.

---

## 1 · What this adds, and why it is the point

Layer A answers *what talks to what*. It is derived from code, carries a file
and line behind every claim, and is rebuilt on every scan.

Layer B answers *what the business actually does* — the L1/L2/L3 process
hierarchy, where a single process spans many repositories and several Kafka
hops. It is written by people, not derived from anything, and it cannot be
scanned out of a codebase because the knowledge is not in the codebase.

Joined, they answer the questions neither can answer alone:

- Which processes break if this topic stops flowing?
- Which services does "Place an order" actually touch, across every repo?
- This service has no callers — is it dead, or does a documented process use it?
- Which parts of our estate does no documented process account for?
- This process document says it calls pricing — does the code still do that?

That last one is the one to build for. **The two layers cross-check each
other.** A process step pointing at a component the topology does not have
means either the scan missed it or the document has gone stale, and both are
findings worth surfacing. Nothing else in the tool can catch that.

### The hierarchy

Three levels, each a many-to-one relationship upward. A process is identified by
its **code** — `2`, `2.6`, `2.6.13` — exactly the number people say out loud.
The code carries the whole hierarchy: the number of segments is the level, and
the parent is the code with its last segment removed. One authored field, no
separate parent pointer to fall out of sync, and "does this code's parent exist"
becomes a checkable invariant.

Codes are stable identifiers. People cite them in tickets and documents, so
renumbering has a real cost — treat a code as permanent once published.

---

## 2 · The contract

[`schema/process-pack.schema.json`](schema/process-pack.schema.json) — written,
validated, and the thing everything here hangs off. Read it before anything
else; as with the manifest schema, its `description` fields are written as
instructions to whoever authors a pack, not as documentation.

[`schema/example.trading-processes.json`](schema/example.trading-processes.json)
is a valid pack against the Meridian estate: 10 processes, 6 leaves, 16 steps.
It is your Phase 7 fixture.

### The five things that matter in it

**A pack is the unit of ingest.** Processes span repositories, so unlike a scan
manifest there is nothing per-repo about them. A pack is a domain's worth of
process — `trading`, `onboarding` — and re-ingesting it replaces exactly what it
previously contributed.

**A pack never creates a component.** It only references components a scan
already established. This is not a convenience, it is the guarantee: if a pack
could bring nodes into existence, the estate would fill with components nobody
has ever seen in code, and the evidence promise that makes Layer A trustworthy
would quietly stop meaning anything. A reference that does not resolve becomes a
finding; it never becomes a node.

**Steps belong to leaves.** A process with children must not have steps — the
children *are* its detail. A parent's component usage is derived by rolling up
its descendants, never hand-authored, because hand-authored rollups drift from
the thing they summarise within a month.

**Interactions are written the way a person can write them.** An edge id is
`sha1(from|kind|to)` and nobody types that. A step names `{from, kind, to}` and
ingest resolves it with the *same* `edgeId()` helper `server/src/ingest.js`
already exports. Import it; do not reimplement the hashing.

**Processes carry a source, not evidence.** Layer A facts cite a file and a
line because they are derived from code. Layer B facts are asserted by people,
so they carry attribution — a Confluence page, a diagram, the person who
confirmed it, and when. Do not bolt an `evidence` array onto processes, and
never fabricate a code citation for a process step.

---

## 3 · Database schema

The `processes` and `process_steps` tables currently in `server/src/db.js` are
the unused placeholders from the original spec. **Replace them** — nothing reads
or writes them, so there is no data to migrate. Drop them explicitly at the top
of the schema block (`DROP TABLE IF EXISTS process_steps; DROP TABLE IF EXISTS
processes;`) before the new `CREATE TABLE`s, so an existing database picks up
the new shape; note the drop in `DECISIONS.md`.

```sql
-- ─────────────────────────────────────────────────── pack ingest log

CREATE TABLE IF NOT EXISTS process_packs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pack            TEXT NOT NULL,
  name            TEXT,
  description     TEXT,
  authored_at     TEXT,
  ingested_at     TEXT NOT NULL,
  schema_version  INTEGER,
  prompt_version  TEXT,
  producer_kind   TEXT,
  producer_detail TEXT,
  source          TEXT,            -- JSON, the pack-level default
  source_file     TEXT,
  status          TEXT NOT NULL,   -- active | superseded | quarantined
  raw             TEXT NOT NULL,
  errors          TEXT
);
CREATE INDEX IF NOT EXISTS process_packs_pack ON process_packs (pack, status);

-- ─────────────────────────────────────────────────── the hierarchy

CREATE TABLE IF NOT EXISTS processes (
  id          TEXT PRIMARY KEY,          -- 'proc:2.6.13'
  code        TEXT NOT NULL UNIQUE,      -- '2.6.13'
  level       INTEGER NOT NULL,          -- derived: segment count, 1-3
  parent_id   TEXT,                      -- derived: 'proc:2.6'; NULL at level 1
  sort_key    TEXT NOT NULL,             -- see below — NOT the code
  name        TEXT NOT NULL,
  description TEXT,
  owner       TEXT,
  trigger     TEXT,
  outcome     TEXT,
  tags        TEXT,                      -- JSON array
  source      TEXT,                      -- JSON; the pack's when the process has none
  pack_id     INTEGER NOT NULL REFERENCES process_packs(id) ON DELETE CASCADE,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS processes_parent ON processes (parent_id);
CREATE INDEX IF NOT EXISTS processes_sort   ON processes (sort_key);

CREATE TABLE IF NOT EXISTS process_steps (
  id          TEXT PRIMARY KEY,          -- 'proc:2.1.1#3'  (code + seq)
  process_id  TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  actor       TEXT,
  node_id     TEXT,                      -- may not exist in nodes; that is a finding
  edge_id     TEXT,                      -- resolved via edgeId(); NULL when unresolved
  edge_from   TEXT,                      -- the interaction kept verbatim, so an
  edge_kind   TEXT,                      -- unresolved one is still displayable and
  edge_to     TEXT,                      -- still explains what the author meant
  optional    INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  pack_id     INTEGER NOT NULL REFERENCES process_packs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS process_steps_process ON process_steps (process_id, seq);
CREATE INDEX IF NOT EXISTS process_steps_node    ON process_steps (node_id);

-- ─────────────────────────────── the join, rebuilt by the link pass

CREATE TABLE IF NOT EXISTS process_components (
  process_id TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  via        TEXT NOT NULL,   -- step | touches | rollup  (the most direct wins)
  PRIMARY KEY (process_id, node_id)
);
CREATE INDEX IF NOT EXISTS process_components_node ON process_components (node_id);

CREATE TABLE IF NOT EXISTS process_edges (
  process_id TEXT NOT NULL,
  edge_id    TEXT NOT NULL,
  via        TEXT NOT NULL,   -- step | rollup
  PRIMARY KEY (process_id, edge_id)
);
CREATE INDEX IF NOT EXISTS process_edges_edge ON process_edges (edge_id);
```

### `sort_key`, and the trap it exists for

Never order by `code`. Lexically, `2.10` sorts before `2.9` and `10` before `2`,
so a tree ordered by code is wrong the moment any level reaches ten children —
which is exactly the case the user named when they said "2.6.13".

`sort_key` is the code with every segment zero-padded to four digits, joined by
dots: `2.6.13` → `0002.0006.0013`, `10` → `0010`. Lexical order over that is
numeric order. Compute it on insert; order by it everywhere.

---

## 4 · Ingest

New file `server/src/processes.js`, exporting `ingestProcessPack(json,
sourceFile)`. It mirrors `ingestManifest()` deliberately — read that function
first and follow its shape.

1. **Validate** against `schema/process-pack.schema.json` with the same ajv
   setup `ingest.js` uses.
2. **On failure**, insert a `process_packs` row with `status='quarantined'`,
   the raw body and the ajv errors, and import nothing. Same rule as Layer A:
   **a quarantined pack imports nothing at all.**
3. **On success**, in one transaction:
   - Supersede every `active` pack with this `pack` id; its rows cascade away.
   - Insert the new `process_packs` row as `active`.
   - For each process: derive `level` from the segment count, `parent_id` from
     the code minus its last segment, `sort_key` per §3, and `id` as
     `proc:<code>`. Fall back to the pack's `source` when the process has none.
   - For each step: `id` is `proc:<code>#<seq>`; resolve `interaction` to
     `edge_id` with `edgeId(from, kind, to)` imported from `ingest.js`, and keep
     `from`/`kind`/`to` in their own columns either way.
   - **Do not touch the `nodes` or `edges` tables.** Not to create, not to
     update, not to mark. A pack is a reader of topology.
4. **Preserve `first_seen`** across re-ingests, as Layer A does; set `last_seen`.
5. Run the link pass (§5) and rebuild the search index (§6). Both are global.

### Where packs arrive

The same `inbox/`. `sweepInbox()` currently assumes every file is a manifest;
it must now route by shape:

- has a `repo` property → scan manifest, existing path
- has a `pack` property → process pack, new path
- neither → quarantine with the message *"not a scan manifest (no `repo`) or a
  process pack (no `pack`)"*

One drop point, no subfolders, no filename conventions to remember.

`npm run validate -- <file>` must do the same routing and validate against the
right schema. Say which one it picked in the success line.

---

## 5 · The link pass

Extend `server/src/link.js`. Everything here is global and deterministic, and
runs after every ingest of either kind — a new scan manifest can resolve a
process step that did not resolve yesterday, and must.

### Rollup

Rebuild `process_components` and `process_edges` from scratch each time:

1. **Direct.** For every process: its steps' `node_id`s and its `touches` become
   `process_components` rows with `via='step'` or `via='touches'`; its steps'
   resolved `edge_id`s become `process_edges` with `via='step'`.
2. **Upward.** Walk levels 3 → 2 → 1. Every component and edge of a process is
   also a component and edge of its parent, with `via='rollup'`.
3. On conflict keep the most direct provenance: `step` beats `touches` beats
   `rollup`.

Rollup is global, not per-pack, because a parent can legitimately live in a
different pack from its children. Do it here, never inside the pack insert.

### New findings

Added to the existing `drift` table and the existing `rebuildDrift()`. Write
them in the same voice as the Layer A findings already there — a sentence naming
the parties, with the data the UI needs attached.

| `kind` | Condition | Severity |
|---|---|---|
| `process-missing-component` | a step's `node_id` or a `touches` entry is not in `nodes` | warn |
| `process-missing-interaction` | a step's interaction does not resolve to an edge | warn |
| `process-orphan-code` | a code whose parent code is absent from the estate | warn |
| `process-duplicate-code` | two active packs declare the same code | warn |
| `process-steps-on-parent` | a process with children also carries steps | warn |
| `process-no-detail` | a leaf with neither steps nor `touches` — a title and nothing else | info |
| `uncovered-component` | a `service` or `kafka.topic` no process touches | info |

Two judgement calls baked into that table:

**`process-missing-component` and `process-missing-interaction` are separate
findings** because the fix differs. The first means a component is missing or
misnamed; the second means the components both exist but the relationship
between them is not in the code — often the most interesting finding in the
tool, because it is either a scan gap or a process that no longer works the way
the document claims.

**`uncovered-component` fires only when at least one pack is loaded**, and only
for services and topics. Fired against an empty Layer B it would report the
whole estate and train people to ignore it.

**A pack never modifies a node.** Re-state that to yourself before writing
`rebuildDrift()`: a missing component is *reported*, never created. Contrast
with Layer A's `createOrphans()`, which does create nodes — that is correct
there, because an edge in a scan is evidence that the other end exists. A
sentence in a document is not.

---

## 6 · Search

Extend `rebuildSearch()` in `ingest.js` (or move it somewhere shared — your
call, record it). Two new subject kinds:

- `process` — `title` is `<code> · <name>`; `body` carries the code, name,
  description, trigger, outcome, owner, tags and every component id it touches.
  Searching a service id must find the processes that use it.
- `process-step` — `title` is the step name; `body` carries its description,
  actor, node id and interaction. `subject_id` is the step id, and a hit routes
  to its process.

Searching `2.6` must find process `2.6`. Searching a topic name must find both
the topic and the processes that flow through it.

---

## 7 · HTTP API

Ids and codes are query parameters, never path segments — same rule as Layer A,
and a code like `2.6.13` in a path is a trap waiting for a route matcher.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/processes` | `{processes:[{id,code,level,parentId,name,description,owner,childCount,stepCount,componentCount,packId,coverage}]}`, ordered by `sort_key`. The whole tree in one call — it is small. |
| GET | `/api/process?code=` | `{process, ancestors:[…], children:[…], steps:[…], components:[…], edges:[…], drift:[…], pack}`. Steps come back with their node and edge *resolved* where possible, and flagged `unresolved:true` where not. |
| GET | `/api/process-packs` | the pack ingest log, newest first, quarantined rows carrying their errors |
| GET | `/api/coverage` | `{components:[{node, processes:[{code,name}], covered:bool}]}` — the join from the component side |
| POST | `/api/ingest/process-pack` | body = a pack → `{ok, pack, counts}` or `{ok:false, errors}` |

Extend four existing endpoints:

- **`GET /api/prompt`** must serve
  [`prompts/author-processes.md`](prompts/author-processes.md), which needs
  three substitutions beyond the `{{SCHEMA}}` it already does: `{{PACK}}` from
  the query, `{{COMPONENTS}}` — every node in the map as `id · name`, grouped by
  kind — and `{{PROCESSES}}` — the codes already loaded with their names, so an
  author does not collide with another pack. Without those the prompt is
  useless, because its central rule is "only reference components that exist".

- **`GET /api/node?id=`** gains `processes: [{code, name, level, via}]` — every
  process that touches this component, most direct first. This is what puts
  "which business processes use this service" on the node page.
- **`GET /api/graph`** gains `process=<code>`: restrict to that process's
  components and edges. Combined with `focus`, the process wins as the filter
  and `focus` only selects.
- **`GET /api/status`** gains `counts.processes`, `counts.processLeaves`,
  `counts.processPacks`, and `coverage` as `{covered, total}` over services and
  topics.

---

## 8 · The UI

### `/processes` — the tree

The L1/L2/L3 hierarchy as an indented, collapsible tree, ordered by `sort_key`.
Each row: code, name, owner, and a small coverage indicator (how many components
it touches). L1 and L2 rows show their child count. Clicking a row opens the
detail page; the expand/collapse state persists in `localStorage`.

Keep it dense. Twenty-four rows should fit on one screen without scrolling —
this is a navigation surface, not a report.

### `/process?code=` — the detail

The most important new page. In order:

1. **Header** — `2.1.1 · Validate and price the order`, the owner, the level,
   and breadcrumbs of its ancestors as links.
2. **Description**, plus `trigger` and `outcome` when present.
3. **Steps**, for a leaf — a numbered list, each step showing its name,
   description, actor, the component it happens at (linked), and the interaction
   it travels over rendered readably (`order-service → publishes → orders.placed.v1`,
   using `EDGE_LABEL` and `flowDirection()` from `lib/nodes.ts`). A step whose
   node or interaction did not resolve is marked plainly — *"no such component
   in the map"* — not hidden.
4. **Children**, for a parent — each with its own step and component counts.
5. **Components used** — grouped by kind, each linked, each marked `step`,
   `touches` or `rollup`.
6. **Services involved** — the distinct services across the whole subtree. For
   an L1 this is the answer to "how many teams does this process cross", so make
   it prominent.
7. **Findings** naming this process.
8. **Source** — the attribution, with `asOf` shown as an age. A process nobody
   has confirmed in a year should look like it.

### Node detail gains a Processes card

On `/node?id=`, list the processes that touch this component, deepest level
first. On a topic this is the payoff: *"these four business processes flow
through this topic"*, directly under the producers and consumers.

### The map gains a process overlay

In the filter row, a **Process** picker. With one selected, the map draws only
that process's components and the edges between them; everything else is
dropped, not merely dimmed. The existing `focus`/`depth` controls still work
within that subgraph.

This is the feature that makes the whole project worth having: pick "Place an
order", see exactly the services, topics and databases it runs through, across
every repository, laid out. Give it the care it deserves.

### A leaf process renders as a sequence diagram

Mermaid is already a dependency and `reference/` showed how the sibling project
loads it lazily and offline. Generate a `sequenceDiagram` from a leaf's steps:
participants are the distinct services, each step an arrow using the resolved
interaction, `Note over` for a step with no interaction. Put it on the process
detail page behind a chart/diagram toggle.

This closes the loop with where the project started — hand-drawn mermaid process
diagrams — except now they are generated from data that is checked against the
code.

### The scan page gains a second tab

`/scan` currently renders the pass-1 scan prompt. Add a **Processes** tab beside
it that renders `author-processes` for a chosen pack id, with the same copy
button. Same page, same shape — one place a person goes to get a prompt.

### New widgets

In `web/src/dashboard/registry.tsx`, as `WidgetDef` entries plus `WidgetBody`
cases. Do not invent a new rendering path.

| type | what it shows | fields |
|---|---|---|
| `process-tree` | the hierarchy, collapsible | `rootCode`, `maxLevel` |
| `process-steps` | one process's steps | `code` (empty follows the filter row) |
| `process-flow` | the mermaid sequence view | `code` |
| `process-coverage` | components covered vs not, by kind | `nodeKind` |
| `process-list` | leaves with step and component counts | `owner`, `limit` |

Add a seeded **Processes** page (`slug: 'processes'`) carrying the tree, a
coverage widget and a stat row, alongside the five that exist.

---

## 9 · Build order

**Phase 7 — schema and ingest.** The §3 tables, `server/src/processes.js`, the
sweep routing, `validate.mjs` routing, `POST /api/ingest/process-pack`. Prove it
with `schema/example.trading-processes.json` and a deliberately broken copy.

**Phase 8 — rollup and findings.** The §5 rollup and the seven new findings,
wired into the existing link pass. Still no UI; verifiable from the command
line.

**Phase 9 — demo packs.** Three packs covering the Meridian estate (§11),
written into `demo/processes/`, loaded by `npm run seed:demo` alongside the
manifests. Extend `npm run verify` with a process stage. **Do not start the UI
until this passes** — every screen below is easier to build against real data.

**Phase 10 — read API and the core pages.** §7 in full, then `/processes`, the
process detail page, the Processes card on node detail, and search.

**Phase 11 — the payoff.** The map's process overlay, the mermaid flow view,
the five widgets and the seeded Processes page.

Stopping after Phase 10 leaves something genuinely useful. Phase 11 is where it
becomes the thing that was asked for — do not start it on a broken Phase 10.

---

## 10 · Verification

Extend `server/scripts/verify.mjs` with a process stage in the same style. Every
assertion below is checkable without the real repositories.

**Phase 7**
- `npm run validate -- schema/example.trading-processes.json` exits 0 and says
  it validated a *process pack*.
- The same file with `"code": "2.1.1"` changed to `"2.1.1.4"` (four segments)
  exits 1 naming the offending path.
- Posting a broken pack leaves exactly one `process_packs` row with
  `status='quarantined'` and **zero** rows in `processes` and `process_steps`.
- Ingesting the example twice leaves one `active` pack and does not double
  anything.
- `proc:2.1.1` has `level` 3, `parent_id` `proc:2.1`, `sort_key`
  `0002.0001.0001`.
- Every one of the example's 16 steps that carries an interaction resolved to a
  non-null `edge_id` against the seeded estate.
- **Ingesting the example created no new rows in `nodes` or `edges`.** Assert
  the counts are identical before and after. This is the invariant that matters
  most in Phase 7.

**Phase 8**
- `processes` ordered by `sort_key` puts `2.9` before `2.10` — insert a
  throwaway `2.9` and `2.10` to prove it, then remove them.
- `proc:2` rolls up every component of its descendants; `process_components` for
  `proc:2` is a superset of those for `proc:2.1.1`.
- `via` is `step` where a step named the component and `rollup` on the parent.

**Phase 9** — after `npm run seed:demo`:

| | expected |
|---|---|
| process packs, active | 3 |
| processes total | 24 |
| level 1 / 2 / 3 | 3 / 7 / 14 |
| leaves carrying steps | 14 |
| `process-missing-component` findings | exactly 1 |
| `process-orphan-code` findings | 0 |
| `process-duplicate-code` findings | 0 |
| `process-steps-on-parent` findings | 0 |
| `uncovered-component` findings | ≥ 1, including `topic:risk.flagged.v1` |

- `GET /api/node?id=topic:orders.matched.v1` lists at least the ledger and
  reporting processes.
- `GET /api/process?code=2` reports services from more than one team.
- Removing the demo (`npm run seed:demo -- --remove`) clears packs, processes,
  steps and the join tables, and leaves zero process findings.

**Phase 10**
- Searching `2.2.2` finds that process; searching `orders.matched.v1` finds the
  topic *and* the processes that flow through it.
- A step whose component does not resolve renders as unresolved rather than
  vanishing.

**Phase 11**
- Selecting a process on the map shows only its components, and the node count
  matches `GET /api/process?code=`'s component count.
- The mermaid diagram for `2.1.1` renders in both themes.
- Dark mode is legible on every new screen; no horizontal page scroll at 1280px.

---

## 11 · The demo packs

Three packs over the existing Meridian estate, in `demo/processes/`, written and
loaded by `npm run seed:demo` exactly as the manifests are — generated, written
to disk, then read back off disk and ingested, so what is committed is what is
verified.

`schema/example.trading-processes.json` **is** the `trading` pack. Move or copy
it into the demo set rather than writing a second version of it; if you move it,
leave the schema example pointing at the demo copy.

**Pack `trading`** — 10 processes, already written:
`2` Trade → `2.1` Place an order (`2.1.1`, `2.1.2`), `2.2` Match and settle
(`2.2.1`, `2.2.2`, `2.2.3`), `2.3` Tell the customer (`2.3.1`).

**Pack `onboarding`** — 8 processes:

| code | name |
|---|---|
| `1` | Onboard a customer |
| `1.1` | Open an account |
| `1.1.1` | Create the customer record |
| `1.1.2` | Verify identity |
| `1.1.3` | Open the wallets |
| `1.2` | Fund the account |
| `1.2.1` | Take the payment |
| `1.2.2` | Post the deposit to the ledger |

Between them these must touch `svc:identity-service`, `svc:wallet-service`,
`svc:payments-service`, `svc:gateway-api`, `topic:users.created.v2`,
`topic:kyc.approved.v1`, `topic:payments.settled.v1`, `db:postgres/identity`,
`db:postgres/wallet`, `db:postgres/payments`, `cache:redis/session` and
`ext:stripe`.

**Pack `reporting`** — 6 processes:

| code | name |
|---|---|
| `3` | Report |
| `3.1` | Build the read models |
| `3.1.1` | Ingest matched trades |
| `3.1.2` | Ingest balance changes |
| `3.2` | Serve reports |
| `3.2.1` | Answer a report request |

**The deliberate defect.** `3.1.1` has a step referencing
`topic:trades.enriched.v1`, which does not exist in the estate — an enrichment
topic the reporting team's document still describes but which was folded into
the matching engine. It produces exactly one `process-missing-component`, and it
is the demo of the cross-check that justifies the whole layer. Give it a
description that says as much.

Everything else must resolve cleanly. Write real step descriptions, not filler:
this demo is what the screens are designed against, and lorem-grade text
produces lorem-grade layout decisions.

---

## 12 · Invariants

On top of SPEC.md §15, which all still hold:

1. **A process pack never creates or modifies a node or an edge.** It reads
   topology and reports what it cannot find.
2. **A quarantined pack imports nothing.** No partial packs, ever.
3. **`code` is the identity.** Level and parent are derived from it; never store
   a second, independent parent pointer.
4. **Never order by `code`.** Order by `sort_key`, or `2.10` sorts before `2.9`.
5. **A process with children has no steps.** Report it as a finding rather than
   silently rolling up something incoherent.
6. **Rollups are derived, never authored.** A parent's components come from its
   descendants at link time.
7. **Interactions resolve through `edgeId()`** from `ingest.js`. One hashing
   rule, one place.
8. **Processes carry a source, not evidence.** Never fabricate a file and line
   for a human-asserted fact.
9. **An unresolved step is shown, not hidden.** Its whole value is that it is
   visible.
10. **Layer A stays independently correct.** Every one of SPEC.md §14's existing
    assertions must still pass when you are done. `npm run verify` is the gate.
