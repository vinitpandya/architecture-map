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
- Which services does "Getting estimate" actually touch, across every repo?
- This service has no callers — is it dead, or does a documented process use it?
- Which parts of our estate does no documented process account for?
- This process document says it calls pricing — does the code still do that?

That last one is the one to build for. **The two layers cross-check each
other.** A process pointing at a component the topology does not have means
either the scan missed it or the document has gone stale, and both are findings
worth surfacing. Nothing else in the estate can catch that.

### The levels are decomposition, not sequence

This is the thing to get right, and it is easy to get wrong.

Each level says **the same thing in more detail**. It is not a call stack and it
is not a list of hops.

```
L2      Order and execution                      what the business does
L2.1      Getting estimate                       a stage of it
L2.1.1      Take the quote from the cache        the atomic action
L2.1.2      Get prices from the pricing service
L2.1.3      Check the customer may trade
L2.2      Accepting estimate and placing order
L2.2.1      Receive the accepted order
L2.2.2      Persist the order
```

So **a level 3 is already the atomic unit of work.** There is no step list
underneath it. "Get prices from the pricing service" *is* the leaf — it is not
a container of smaller things. If something needs breaking down further, it
becomes siblings at the same level, not a nested list inside one.

Two consequences that shape the whole design:

**Order comes from the numbering.** `2.1` happens before `2.2`; `2.1.1` before
`2.1.2`. There is no separate sequence field anywhere, because the code already
carries it. A flow diagram at any level is simply that level's children in
order.

**A component binds to a process, not to a step.** A level 3 normally names one
`node` — the component the work happens at — and one `interaction` — the
relationship it travels over. Higher levels name nothing of their own; their
component list is derived by rolling their children up.

### The code

A process is identified by its **pack and its code together**: `proc:<pack>:<code>`,
so `proc:onboarding:2.1.1`. The code carries the whole hierarchy — the number of
segments is the level, the parent is the code minus its last segment — so there
is no separate parent pointer to fall out of sync, and "does this code's parent
exist" becomes a checkable invariant, inside the pack.

An optional leading `L` is accepted on input and stripped: `L2.1.1` and `2.1.1`
are the same process. Store the code numerically; display it with the prefix,
since that is how people write it, and with the pack beside it — `onboarding
L2.1.1` — since that is what addresses one.

**A code belongs to its pack, and to nothing above it.** This is a correction
to how it was first built, and the reason is worth stating. The code alone was
the identity once, which made it a single estate-wide number line that every
pack had to be numbered against. That works only while one person is numbering.
Packs are authored independently — a team at a time, a repository at a time, by
somebody who cannot see what anybody else has written — so they all began at 1,
and the last pack ingested silently took every code the others had claimed.
Hundreds of authored processes came out as a handful of rows, and the only
symptom was a tree that looked short.

Per pack, two teams both starting at 1 are both right and neither has to
coordinate with the other. What it costs is that a code no longer addresses a
process on its own: every link, filter and reference carries the pack too.

A reference from one process to another — `handsOffTo`, `next` — is a bare code
when it stays inside the pack, which is the overwhelming case, and
`<pack>#<code>` when it leaves. A bare code cannot reach outside its pack.

Codes are stable identifiers. People cite them in tickets and documents, so
renumbering has a real cost — treat a code as permanent once published.

### What a pack covers

A pack declares `covers`: the `team` that owns the document, and the `services`
whose work it describes. It is optional, and it does three things.

It says what the pack is for without opening it. It scopes the authoring
prompt, so the next author is handed that boundary's components rather than the
whole estate — which is most of the prompt's length, and every component in it
that the team does not run is a chance to bind a process to the wrong service.
And it makes `process-outside-covers` derivable: a process whose `node` — where
the work happens — is outside the boundary.

Only `node`. An `interaction` leaving the boundary is a handoff and the most
valuable thing in a pack; reporting those would report every crossing in the
estate and bury the one case worth a line, which is a pack claiming that
somebody else's service does its work.

---

## 2 · The contract

[`schema/process-pack.schema.json`](schema/process-pack.schema.json) — written,
validated, and the thing everything here hangs off. Read it before anything
else; as with the manifest schema, its `description` fields are written as
instructions to whoever authors a pack, not as documentation.

[`schema/example.order-and-execution.json`](schema/example.order-and-execution.json)
is a valid pack against the Meridian estate: 20 processes — 1 at level 1, 4 at
level 2, 15 at level 3 — every leaf carrying exactly one interaction. It is your
Phase 7 fixture, and it is the shape every pack should look like.

### The six things that matter in it

**A pack is the unit of ingest.** Processes span repositories, so unlike a scan
manifest there is nothing per-repo about them. A pack is a domain's worth of
process — `order-and-execution`, `onboarding` — and re-ingesting it replaces
exactly what it previously contributed.

**A pack never creates a component.** It only references components a scan
already established. This is not a convenience, it is the guarantee: if a pack
could bring nodes into existence, the estate would fill with components nobody
has ever seen in code, and the evidence promise that makes Layer A trustworthy
would quietly stop meaning anything. A reference that does not resolve becomes a
finding; it never becomes a node.

**Every level is the same shape.** There is no separate step object and no
special leaf type. A level 1 and a level 3 are both `process` records; they
differ only in how much they decompose and whether they name a component. Do not
introduce a second shape for leaves.

**Interactions are written the way a person can write them.** An edge id is
`sha1(from|kind|to)` and nobody types that. A process names `{from, kind, to}`
and ingest resolves it with the *same* `edgeId()` helper `server/src/ingest.js`
already exports. Import it; do not reimplement the hashing.

**Processes carry a source, not evidence.** Layer A facts cite a file and a
line because they are derived from code. Layer B facts are asserted by people,
so they carry attribution — a Confluence page, a diagram, the person who
confirmed it, and when. Do not bolt an `evidence` array onto processes, and
never fabricate a code citation for a process.

**The numbering is still the order, and `next` says only what it cannot.** A
process may carry `next: [{when, process | end}]`, and a process without one
falls through to the next sibling exactly as it always has. So `next` is never
the sequence — it is the departures from it: a decision with two outcomes, an
error path that skips ahead, a retry that points back, a step that stops the
process. Two consequences follow, and both are the point. A pack written before
`next` existed still draws the straight line it always described, and a `next`
that merely restates the numbering is noise the first renumbering will break.
The rules a code follows apply to it unchanged: a `process` it names may belong
to a pack nobody has written, which is reported and never rejected.

---

## 3 · Database schema

The `processes` and `process_steps` tables currently in `server/src/db.js` are
unused placeholders from the original spec. **Replace them.** Nothing reads or
writes them, so there is nothing to migrate: drop them explicitly at the top of
the schema block (`DROP TABLE IF EXISTS process_steps; DROP TABLE IF EXISTS
processes;`) before the new `CREATE TABLE`s, so an existing database picks up
the new shape. Note the drop in `DECISIONS.md`.

There is no `process_steps` table in the new design — a step *is* a process.

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

-- ────────────────────────────────── the hierarchy: one row per process,
--                                    at every level

CREATE TABLE IF NOT EXISTS processes (
  id          TEXT PRIMARY KEY,          -- 'proc:onboarding:2.1.1'
  pack        TEXT NOT NULL,             -- 'onboarding', the pack's own id
  code        TEXT NOT NULL,             -- '2.1.1', the L stripped
  level       INTEGER NOT NULL,          -- derived: segment count, 1-3
  parent_id   TEXT,                      -- derived: 'proc:onboarding:2.1'; NULL at level 1
  sort_key    TEXT NOT NULL,             -- see below — NOT the code
  name        TEXT NOT NULL,
  description TEXT,
  owner       TEXT,
  actor       TEXT,
  trigger     TEXT,
  outcome     TEXT,
  node_id     TEXT,                      -- may not exist in nodes; that is a finding
  edge_id     TEXT,                      -- resolved via edgeId(); NULL when unresolved
  edge_from   TEXT,                      -- the interaction kept verbatim, so an
  edge_kind   TEXT,                      -- unresolved one is still displayable and
  edge_to     TEXT,                      -- still explains what the author meant
  optional    INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  tags        TEXT,                      -- JSON array
  source      TEXT,                      -- JSON; the pack's when the process has none
  pack_id     INTEGER NOT NULL REFERENCES process_packs(id) ON DELETE CASCADE,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  UNIQUE (pack, code)                    -- per pack: a number line belongs to
);                                       -- whoever is numbering
CREATE INDEX IF NOT EXISTS processes_parent ON processes (parent_id);
CREATE INDEX IF NOT EXISTS processes_sort   ON processes (sort_key);
CREATE INDEX IF NOT EXISTS processes_node   ON processes (node_id);

-- ─────────────────────────────── the join, rebuilt by the link pass

CREATE TABLE IF NOT EXISTS process_components (
  process_id TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  via        TEXT NOT NULL,   -- node | interaction | touches | exposes | rollup
  PRIMARY KEY (process_id, node_id)
);
CREATE INDEX IF NOT EXISTS process_components_node ON process_components (node_id);

CREATE TABLE IF NOT EXISTS process_edges (
  process_id TEXT NOT NULL,
  edge_id    TEXT NOT NULL,
  via        TEXT NOT NULL,   -- interaction | rollup
  PRIMARY KEY (process_id, edge_id)
);
CREATE INDEX IF NOT EXISTS process_edges_edge ON process_edges (edge_id);
```

### `process_next`

```sql
CREATE TABLE IF NOT EXISTS process_next (
  from_id   TEXT NOT NULL,      -- 'proc:2.1.3'
  seq       INTEGER NOT NULL,   -- position in the authored list; the drawing order
  condition TEXT,               -- 'the customer is permitted'; NULL is unconditional
  to_id     TEXT,               -- 'proc:2.1.5'; NULL when this branch ends
  resolved  INTEGER NOT NULL DEFAULT 0,
  end_label TEXT,               -- 'Order rejected', when the branch stops here
  PRIMARY KEY (from_id, seq)
);
```

Rebuilt whole by the link pass off `process_packs.raw`, exactly as `touches` and
`handsOffTo` are and for the same reason: nothing but the link pass reads the
authored form, so a column on `processes` would be a column nothing else ever
looked at. A branch naming a code nobody has written is kept with `resolved = 0`
rather than dropped — the branch is still what the author said, and hiding it
would make the flow look complete when it is not. A branch to the process it
leaves is the one loop nobody means, and is dropped.

### `sort_key`, and the trap it exists for

Never order by `code`. Lexically, `2.10` sorts before `2.9` and `10` before `2`,
so a tree ordered by code is wrong the moment any level reaches ten children —
and with processes this granular, ten children is the common case, not the edge
case.

`sort_key` is the code with every segment zero-padded to four digits, joined by
dots: `2.1.1` → `0002.0001.0001`, `2.10` → `0002.0010`. Lexical order over that
is numeric order. Compute it on insert; order by it everywhere.

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
   - For each process: strip any leading `L` from the code, derive `level` from
     the segment count, `parent_id` from the code minus its last segment,
     `sort_key` per §3, and `id` as `proc:<pack>:<code>`. Fall back to the
     pack's `source` when the process has none.
   - Resolve `handsOffTo[].process` and `next[].process`: a bare code is this
     pack's, `<pack>#<code>` is somebody else's.
   - Resolve `interaction` to `edge_id` with `edgeId(from, kind, to)` imported
     from `ingest.js`, and keep `from`/`kind`/`to` in their own columns either
     way, so an unresolved interaction is still displayable.
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
process that did not resolve yesterday, and must.

### Rollup

Rebuild `process_components` and `process_edges` from scratch each time:

1. **Direct.** For each process: its `node_id` (`via='node'`), the two ends of
   its resolved interaction (`via='interaction'`), and its `touches` entries
   (`via='touches'`). Its resolved `edge_id` becomes a `process_edges` row with
   `via='interaction'`.
2. **Exposing service.** When a process touches an `endpoint`, it also touches
   the service that exposes it, found through the `http.expose` edge, with
   `via='exposes'`. Without this rule a process that calls
   `api:pricing-service/GET /v1/rates/{}` would never register as using
   pricing-service, and "which processes use this service" — the main question
   the page has to answer — would be wrong. Do not generalise the rule any
   further: a process that touches a topic does **not** thereby touch everything
   else on that topic, or every process would touch everything.
3. **Upward.** Walk levels 3 → 2 → 1. Every component and edge of a process is
   also a component and edge of its parent, with `via='rollup'`.
4. On conflict keep the most direct provenance, in this order:
   `node` › `interaction` › `touches` › `exposes` › `rollup`.

Rollup is global, not per-pack, because a parent can legitimately live in a
different pack from its children. Do it here, never inside the pack insert.

### New findings

Added to the existing `drift` table and the existing `rebuildDrift()`. Write
them in the same voice as the Layer A findings already there — a sentence naming
the parties, with the data the UI needs attached.

| `kind` | Condition | Severity |
|---|---|---|
| `process-missing-component` | a `node_id`, an interaction end, or a `touches` entry is not in `nodes` | warn |
| `process-missing-interaction` | an interaction whose **two ends both exist** but which is not an edge in the topology | warn |
| `process-orphan-code` | a code whose parent code is absent from the estate | warn |
| `process-duplicate-code` | two active packs declare the same code | warn |
| `process-no-detail` | a leaf with no `node`, no `interaction` and no `touches` — a title and nothing else | info |
| `uncovered-component` | a `service` or `kafka.topic` no process touches | info |
| `process-flow-unknown-target` | a `next` naming a code that no pack declares | warn |

Four judgement calls baked into that table:

**The two "missing" findings never double-report.** If an interaction fails to
resolve because one of its ends is not in `nodes`, that is
`process-missing-component` only — the root cause. `process-missing-interaction`
fires only when both ends are real and the relationship between them is not.
That second one is the most interesting finding in the tool: it means the
document describes a call the code does not make, so either the scan missed it
or the process has quietly changed.

**There is no `process-steps-on-parent` finding**, because there are no steps. A
parent that names a `node` is not an error either — it is unusual, and the
rollup simply includes it. Do not invent a finding for it.

**`uncovered-component` fires only when at least one pack is loaded**, and only
for services and topics. Fired against an empty Layer B it would report the
whole estate and train people to ignore it.

**`process-flow-unknown-target` is the same rule once more.** A pack may not
bring a process into existence, so a branch to a code that does not resolve is
reported rather than rejected. It is a likelier mistake than an unknown handoff
target, because a branch is usually written to a sibling and a renumbering
breaks it silently — the flow simply stops drawing that arm.

**A pack never modifies a node.** Re-state that to yourself before writing this:
a missing component is *reported*, never created. Contrast with Layer A's
`createOrphans()`, which does create nodes — correct there, because an edge in a
scan is evidence that the other end exists. A sentence in a document is not.

---

## 6 · Search

Extend `rebuildSearch()` in `ingest.js` (or move it somewhere shared — your
call, record it). One new subject kind:

- `process` — `title` is `L<code> · <name>`; `body` carries the code with and
  without its prefix, the name, description, trigger, outcome, owner, actor,
  tags and every component id it touches.

Searching `2.1.1` or `L2.1.1` must find that process. Searching a service id
must find the processes that use it. Searching a topic name must find both the
topic and the processes that flow through it.

---

## 7 · HTTP API

Ids and codes are query parameters, never path segments — same rule as Layer A,
and a code like `2.1.1` in a path is a trap waiting for a route matcher.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/processes` | `{processes:[{id,code,level,parentId,name,description,owner,childCount,componentCount,node,edge,packId}]}`, ordered by `sort_key`. The whole tree in one call — it is small. |
| GET | `/api/process?code=` | `{process, ancestors:[…], children:[…], descendants:[…], components:[…], edges:[…], services:[…], drift:[…], pack}`. `children` are ordered and come back with their node and edge *resolved* where possible and flagged `unresolved:true` where not. |
| GET | `/api/process-packs` | the pack ingest log, newest first, quarantined rows carrying their errors |
| GET | `/api/coverage` | `{components:[{node, processes:[{code,name}], covered:bool}]}` — the join from the component side |
| POST | `/api/ingest/process-pack` | body = a pack → `{ok, pack, counts}` or `{ok:false, errors}` |

A code arrives with or without its `L`; normalise before looking it up.

Extend four existing endpoints:

- **`GET /api/node?id=`** gains `processes: [{code, name, level, via}]` — every
  process that touches this component, most direct first. This is what puts
  "which business processes use this service" on the node page.
- **`GET /api/graph`** gains `process=<code>`: restrict to that process's
  components and edges, rolled up, so asking for `2` gives the whole of order
  and execution and `2.1` gives just the estimate. Combined with `focus`, the
  process wins as the filter and `focus` only selects.
- **`GET /api/status`** gains `counts.processes`, `counts.processLeaves`,
  `counts.processPacks`, and `coverage` as `{covered, total}` over services and
  topics.
- **`GET /api/prompt`** must serve
  [`prompts/author-processes.md`](prompts/author-processes.md), which needs
  three substitutions beyond the `{{SCHEMA}}` it already does: `{{PACK}}` from
  the query, `{{COMPONENTS}}` — every node in the map as `id · name`, grouped by
  kind — and `{{PROCESSES}}` — the codes already loaded with their names, so an
  author does not collide with another pack. Without those the prompt is
  useless, because its central rule is "only reference components that exist".

---

## 8 · The UI

### `/processes` — the tree

The L1/L2/L3 hierarchy as an indented, collapsible tree, ordered by `sort_key`.
Each row: the code with its `L` prefix, the name, the owner, and — for a leaf —
the component it happens at. Parent rows show their child count.

Keep it dense. This is a navigation surface, not a report: a level 1 and its
level 2 children should fit on one screen.

### `/process?code=` — the detail

The most important new page. In order:

1. **Header** — `L2.1.1 · Get prices from the pricing service`, the owner, the
   level, and breadcrumbs of its ancestors as links.
2. **Description**, plus `trigger`, `outcome` and `actor` where present.
3. **Children**, in order — the decomposition. Each row shows its code, name,
   the component it happens at and the interaction it travels over, rendered
   readably (`order-service → calls → pricing-service`, using `EDGE_LABEL` and
   `flowDirection()` from `lib/nodes.ts`). This list *is* the flow, so number it
   and let it read top to bottom. A child whose component or interaction did not
   resolve is marked plainly — *"no such component in the map"* — never hidden.
4. **This process's own component and interaction**, when it has them — the
   usual case at level 3, where there are no children and this is the content.
5. **Components used** — the full rolled-up list, grouped by kind, each linked
   and marked with its `via`.
6. **Services involved** — the distinct services across the whole subtree. For a
   level 1 this is the answer to "how many teams does this process cross", so
   make it prominent.
7. **Findings** naming this process.
8. **Source** — the attribution, with `asOf` shown as an age. A process nobody
   has confirmed in a year should look like it.

### Node detail gains a Processes card

On `/node?id=`, list the processes that touch this component, deepest level
first, each showing how it touches it. On a topic this is the payoff: *"these
four business processes flow through this topic"*, directly under the producers
and consumers.

### The map gains a process overlay

In the filter row, a **Process** picker over the tree. With one selected, the map
draws only that process's rolled-up components and the edges between them;
everything else is dropped, not merely dimmed. The existing `focus`/`depth`
controls still work within that subgraph.

This is the feature that makes the whole project worth having: pick "Getting
estimate", see exactly the services, endpoints, caches and topics it runs
through, across every repository, laid out. Give it the care it deserves.

### A process renders as a diagram — five of them

Mermaid is already a dependency. For any process with children, generate the
diagram from **the children in order**, because the children are the flow. That
one fact is why all five work at every level without a second data model.

| | What it answers | Drawn from |
|---|---|---|
| **Sequence** | what talks to what, in order | each child's resolved interaction; `Note over` where there is none |
| **Flow** | what happens, what decides it, where it stops | the children, `next`, `trigger`, `outcome`, `optional` |
| **Lanes** | where the work crosses a boundary | the same, split by team — or by component where one team does all of it |
| **Handoffs** | who picks it up | `process_links`, grouped into team lanes |
| **Decomposition** | what it is made of | the descendants, parented by their codes |

Put them on the process detail page behind the existing diagram/list toggle,
with one control for which — the same rows drawn five ways are one thing on the
page, not five cards. Offer only the ones with something to draw: a level 3
decomposes into nothing, a process that hands off to nobody has no handoff
picture, and a stage where one team does everything has one lane, which is a
flowchart with a box round it.

This closes the loop with where the project started — hand-drawn mermaid process
diagrams — except now they are generated from data that is checked against the
code, and a branch that leads to a process nobody wrote is drawn as the dead end
it is.

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
| `process-children` | one process's children, in order, with their components | `code` (empty follows the filter row) |
| `process-flow` | the mermaid view of a process's children | `code` |
| `process-coverage` | components covered vs not, by kind | `nodeKind` |
| `process-list` | leaves with their components | `owner`, `limit` |

Add a seeded **Processes** page (`slug: 'processes'`) carrying the tree, a
coverage widget and a stat row, alongside the five that exist.

---

## 9 · Build order

**Phase 7 — schema and ingest.** The §3 tables, `server/src/processes.js`, the
sweep routing, `validate.mjs` routing, `POST /api/ingest/process-pack`. Prove it
with `schema/example.order-and-execution.json` and a deliberately broken copy.

**Phase 8 — rollup and findings.** The §5 rollup and the six new findings, wired
into the existing link pass. Still no UI; verifiable from the command line.

**Phase 9 — demo packs.** Three packs covering the Meridian estate (§11),
written into `demo/processes/`, loaded by `npm run seed:demo` alongside the
manifests. Extend `npm run verify` with a process stage. **Do not start the UI
until this passes** — every screen below is easier to build against real data.

**Phase 10 — read API and the core pages.** §7 in full, then `/processes`, the
process detail page, the Processes card on node detail, and search.

**Phase 11 — the payoff.** The map's process overlay, the mermaid flow view, the
five widgets and the seeded Processes page.

Stopping after Phase 10 leaves something genuinely useful. Phase 11 is where it
becomes the thing that was asked for — do not start it on a broken Phase 10.

---

## 10 · Verification

Extend `server/scripts/verify.mjs` with a process stage in the same style. Every
assertion below is checkable without the real repositories.

**Phase 7**
- `npm run validate -- schema/example.order-and-execution.json` exits 0 and says
  it validated a *process pack*.
- The same file with a code changed to `2.1.1.4` (four segments) exits 1 naming
  the offending path.
- A pack whose code is written `L2.1.1` ingests to the same row as `2.1.1`.
- Posting a broken pack leaves exactly one `process_packs` row with
  `status='quarantined'` and **zero** rows in `processes`.
- Ingesting the example twice leaves one `active` pack and does not double
  anything.
- `proc:2.1.1` has `level` 3, `parent_id` `proc:2.1`, `sort_key`
  `0002.0001.0001`.
- All 15 of the example's leaves resolved to a non-null `edge_id` against the
  seeded estate.
- **Ingesting the example created no new rows in `nodes` or `edges`.** Assert
  the counts are identical before and after. This is the invariant that matters
  most in Phase 7.

**Phase 8**
- Ordering by `sort_key` puts `2.9` before `2.10` — insert a throwaway `2.9` and
  `2.10`, assert, remove them.
- `proc:2` rolls up every component of its descendants; `process_components` for
  `proc:2` is a superset of those for `proc:2.1.1`.
- `proc:2.1.2` calls `api:pricing-service/GET /v1/rates/{}` and therefore also
  has `svc:pricing-service` with `via='exposes'`.
- `via` is `node` or `interaction` where the process named the component, and
  `rollup` on its parent.

**Phase 9** — after `npm run seed:demo`:

| | expected |
|---|---|
| process packs, active | 3 |
| processes total | 46 |
| level 1 / 2 / 3 | 3 / 9 / 34 |
| leaves | 34 |
| `process-missing-component` | exactly 1 — `topic:trades.enriched.v1` from `3.1.1` |
| `process-missing-interaction` | exactly 1 — `3.2.3`, reporting calling the wallet balance endpoint |
| `process-orphan-code` | 0 |
| `process-duplicate-code` | 0 |
| `process-no-detail` | 0 |
| `uncovered-component` | exactly 2 — `topic:risk.flagged.v1` and `topic:notifications.requested.v1` |
| services with no process | 0 |

- `GET /api/node?id=topic:orders.matched.v1` lists the ledger, wallet and
  reporting processes.
- `GET /api/process?code=2` reports services from more than one team.
- `GET /api/process?code=L2` returns the same thing as `code=2`.
- Removing the demo (`npm run seed:demo -- --remove`) clears packs, processes
  and the join tables, and leaves zero process findings.
- **`npm run verify` still passes every existing Layer A assertion.**

**Phase 10**
- Searching `2.3.3` and `L2.3.3` both find that process; searching
  `orders.matched.v1` finds the topic *and* the processes that flow through it.
- A process whose component does not resolve renders as unresolved rather than
  vanishing.

**Phase 11**
- Selecting a process on the map shows only its components, and the node count
  matches `GET /api/process?code=`'s component count.
- The mermaid diagram for `2.1` renders in both themes and shows four actions in
  order.
- Dark mode is legible on every new screen; no horizontal page scroll at 1280px.

---

## 11 · The demo packs

Three packs over the existing Meridian estate, in `demo/processes/`, written and
loaded by `npm run seed:demo` exactly as the manifests are — generated, written
to disk, then read back off disk and ingested, so what is committed is what is
verified.

[`schema/example.order-and-execution.json`](schema/example.order-and-execution.json)
**is** the `order-and-execution` pack, unchanged. Copy it into the demo set; do
not write a second version of it, and do not add the defects below to it — it is
the fixture that must stay clean.

**Pack `order-and-execution`** — 20 processes, already written: `2` with `2.1`
Getting estimate, `2.2` Accepting estimate and placing order, `2.3` Matching and
settlement, `2.4` Telling the customer.

**Pack `onboarding`** — 15 processes:

| code | name |
|---|---|
| `1` | Onboarding and funding |
| `1.1` | Opening an account |
| `1.1.1` | Create the customer record |
| `1.1.2` | Announce the new customer |
| `1.1.3` | Open the wallets |
| `1.1.4` | Start the session |
| `1.2` | Verifying identity |
| `1.2.1` | Record the verification result |
| `1.2.2` | Announce approval |
| `1.2.3` | Enable trading on the wallet |
| `1.3` | Funding the account |
| `1.3.1` | Take the card payment |
| `1.3.2` | Record the payment |
| `1.3.3` | Announce the settled payment |
| `1.3.4` | Post the deposit to the ledger |

Between them these must reach `svc:identity-service`, `svc:wallet-service`,
`svc:payments-service`, `svc:gateway-api`, `svc:ledger-service`,
`topic:users.created.v2`, `topic:kyc.approved.v1`, `topic:payments.settled.v1`,
`db:postgres/identity`, `db:postgres/wallet`, `db:postgres/payments`,
`cache:redis/session` and `ext:stripe`.

**Pack `reporting`** — 11 processes:

| code | name |
|---|---|
| `3` | Reporting |
| `3.1` | Building the read models |
| `3.1.1` | Enrich matched trades |
| `3.1.2` | Ingest matched trades |
| `3.1.3` | Ingest balance changes |
| `3.1.4` | Write the warehouse |
| `3.1.5` | Reconcile against the ledger |
| `3.2` | Serving reports |
| `3.2.1` | Index the report |
| `3.2.2` | Answer a report request |
| `3.2.3` | Look up live balances for the statement |

### The two deliberate defects, both in `reporting`

**`3.1.1` Enrich matched trades** consumes `topic:trades.enriched.v1`, which does
not exist in the estate — an enrichment topic the reporting team's document still
describes, but which was folded into the matching engine a year ago. Exactly one
`process-missing-component`.

**`3.2.3` Look up live balances for the statement** has
`svc:reporting-service` calling `api:wallet-service/GET /v1/wallets/{}/balance`.
Both ends exist; that call is not in the code, because statements are built from
the warehouse instead. Exactly one `process-missing-interaction`.

Together they are the demo of the cross-check that justifies this whole layer:
one document naming a component that is gone, one naming a call that was never
made. Give both a description that says as much.

Everything else must resolve cleanly. Write real descriptions, not filler: this
demo is what the screens are designed against, and lorem-grade text produces
lorem-grade layout decisions.

---

## 12 · Invariants

On top of SPEC.md §15, which all still hold:

1. **A process pack never creates or modifies a node or an edge.** It reads
   topology and reports what it cannot find.
2. **A quarantined pack imports nothing.** No partial packs, ever.
3. **The levels are decomposition, not sequence.** A level 3 is the atomic unit
   of work. There are no steps beneath it, and there is no step table.
4. **Order comes from the code.** No sequence field, anywhere. Siblings are
   ordered by their last segment.
5. **`code` is the identity.** Level and parent are derived from it; never store
   a second, independent parent pointer. An `L` prefix is stripped on input.
6. **Never order by `code`.** Order by `sort_key`, or `2.10` sorts before `2.9`.
7. **Rollups are derived, never authored.** A parent's components come from its
   children at link time.
8. **Interactions resolve through `edgeId()`** from `ingest.js`. One hashing
   rule, one place.
9. **Processes carry a source, not evidence.** Never fabricate a file and line
   for a human-asserted fact.
10. **An unresolved reference is shown, not hidden.** Its whole value is that it
    is visible.
11. **Layer A stays independently correct.** Every one of SPEC.md §14's existing
    assertions must still pass when you are done. `npm run verify` is the gate.
