# Architecture Map — Layer C: teams and handoffs

**Build specification, phases 12–16.** Extends [SPEC.md](SPEC.md) (Layer A) and
[SPEC-PROCESSES.md](SPEC-PROCESSES.md) (Layer B), both complete and verified.
Read this whole file before writing code, then work through §9 Build order,
verifying each phase against §10.

The standing rules still apply: you have no access to the real repositories, you
follow the spec where it speaks and record your own call in `DECISIONS.md` where
it does not, and you never invent data to make a screen look full.

---

## 1 · What this adds, and why it is the point

Layer A answers *what talks to what*. Layer B answers *what the business does*.
Neither answers **who is responsible**, and neither can say **where one team's
work ends and another's begins** — which is the question that actually gets
asked when a department, rather than a single team, starts using the map.

Layer C adds two things and one screen:

1. **A team on every process and every component**, from a registry rather than
   from free text, so "which teams does this process cross" has an exact answer.
2. **Handoffs between processes**, so a process that ends where another team's
   begins says so — derived from the topology where the topology can prove it,
   declared in the pack where it cannot, and the disagreement between the two
   reported as a finding.
3. **The map on the process page.** Layer B gave a process a flow diagram, which
   says what happens in what order. It never showed the *shape* — which
   components, whose, and where the edges leave the team. `/api/graph?process=`
   already returns exactly that subgraph and nothing rendered it.

### A synchronous call is not a handoff

This is the thing to get right, and the obvious rule is wrong.

The tempting derivation is: process A calls `api:identity-service/GET
/v1/users/{}`, identity-service is owned by the identity team, therefore A hands
off to identity's processes. Run that against the demo estate and it produces
**twenty-five** links, of which every one is nonsense. `L2.1.3 Check the
customer may trade` gets linked to four separate identity processes — `Start the
session`, `Verify the document`, and two others — because the rule cannot tell
which identity process, if any, serves that lookup. It cannot tell because
**nothing in the data says**: across all 46 demo processes, not one names an
endpoint as its `node` and not one has an `http.expose` interaction. Packs
document the calling side. Nobody writes down "I am the process that serves the
user lookup", because from the callee's side it is not a process at all.

That is not a gap in the demo data. It is what a synchronous call *is*. When
trading calls the user lookup, trading's process does not end and identity's
does not begin — trading's process continues, holding a response. There is no
handoff to find.

**An event is different.** A publish and a consume are two halves of exactly the
thing this layer is trying to name: one team's work finishes, a message carries
the result over a boundary, and another team's work starts. Both halves are
already in the data, on both sides, written by two different teams who did not
coordinate. The derivation is sound because the fact is real.

So:

- **Handoffs are derived from Kafka only.** Six on the demo estate, five of them
  crossing a team. Rolled up, they say `L2 Order and execution` hands off to
  `L3 Reporting` over `orders.matched.v1` and `wallet.balance.changed.v1` — which
  is the sentence the whole feature exists to produce.
- **Everything else is a dependency, not a handoff.** A process that calls an
  endpoint, reads a store or writes a cache owned by another team *depends* on
  that team. That is a relation between a process and a **team**, not between two
  processes, and it is what carries the HTTP case. Twelve distinct team pairs on
  the demo estate.
- **A pack may declare a handoff the topology cannot show** — a batch job, a
  manual step, an email, or an HTTP call whose receiving process the author
  happens to know. §5 says how much corroboration that claim gets.

### Teams are an attribute, not a node

A team does not go on the map as a node. Layer A's promise is that everything in
the estate was found in code with a file and a line behind it, and a team is an
org fact, not a code fact. Putting `team:trading` in `nodes` would be the same
mistake as letting a process pack create a component.

Team is a **lens** over the estate: colour by it, filter by it, group by it, and
count across it. §8 says how, including why it cannot simply be another colour.

---

## 2 · The contract

### The team registry

`teams.json` at the repo root, with `teams.example.json` committed beside it
exactly as `repos.example.json` is. It is read at request time, not ingested from
a manifest, because it describes the organisation rather than the code.

```json
{
  "departments": [
    { "id": "trading-platform", "name": "Trading Platform",
      "description": "Everything a customer does with their money." }
  ],
  "teams": [
    { "id": "trading", "name": "Trading", "department": "trading-platform",
      "description": "Quotes, orders, matching and settlement.",
      "contact": "#meridian-trading" }
  ]
}
```

`id` is the canonical team id and the thing everything joins on. `department` is
optional and references a `departments[].id`. `description` and `contact` are for
the team page.

**Absence is graceful.** With no `teams.json`, teams are whatever the ingested
data says — ids normalised out of the raw strings, display names taken from the
raw strings — and `unknown-team` never fires. This is the same shape as
`repos.json`: the app works without it, and says so rather than breaking.

### `teamId()`

One normalisation rule, one place, exported from wherever teams live:

    trim → lowercase → collapse whitespace → spaces and underscores to dashes

`Trading` and `trading` resolve to `trading`. `Trading Team` resolves to
`trading-team`, and stays a different team.

**Normalisation fixes case and separators; it does not guess.** Two genuinely
different strings stay two ids, and the registry is the thing that says one of
them was meant to be the other — which is precisely the finding the registry
exists to raise. A normaliser clever enough to merge them would be a normaliser
that silently merges two real teams whose names happen to be similar.

### The pack gains one field

On a process, in
[`schema/process-pack.schema.json`](schema/process-pack.schema.json):

```json
"handsOffTo": [
  { "process": "L3.1.2", "note": "reporting picks the matched order off the topic" }
]
```

`process` is a code, with or without its `L`. `note` is optional and is where an
author says the thing the code cannot: that the handoff is a nightly batch, or a
person, or a call whose far side is not documented. One shape, not two — a bare
string would be less to type and would throw away the only part of a declared
handoff that a derived one does not already have.

`owner` on a process and `team` on a service keep the meanings they already have.
Nothing about them changes except that they now resolve through `teamId()`.

---

## 3 · Database schema

Added to `server/src/db.js`. Nothing existing is dropped or renamed; Layer A and
Layer B keep every column they have.

```sql
-- ─────────────────────────────────────────── the org, from teams.json
CREATE TABLE IF NOT EXISTS departments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id            TEXT PRIMARY KEY,   -- 'trading', canonical, from teamId()
  name          TEXT NOT NULL,      -- 'Trading', for display
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  description   TEXT,
  contact       TEXT,
  registered    INTEGER NOT NULL DEFAULT 0  -- 1 = in teams.json, 0 = seen in data only
);
```

`registered` is the whole point of the table. A team that appears in the data but
not in the registry still gets a row, so every screen can name it — it is simply
marked as not registered, which is what `unknown-team` reports.

```sql
-- ───────────────────────────── derived team on everything, by the link pass
ALTER TABLE nodes     ADD COLUMN team_id TEXT;   -- derived, see §5
ALTER TABLE processes ADD COLUMN team_id TEXT;   -- derived from `owner`
```

Both are **derived columns**, rebuilt whole by the link pass. The raw `team` on a
node and `owner` on a process are left exactly as the scan and the pack wrote
them, because those are the evidence; `team_id` is what everything joins on.

```sql
-- ─────────────────────────────── handoffs between processes, rebuilt whole
CREATE TABLE IF NOT EXISTS process_links (
  id         TEXT PRIMARY KEY,   -- sha1(from_id|kind|to_id|via_node)
  from_id    TEXT NOT NULL,      -- 'proc:2.3.2'
  to_id      TEXT NOT NULL,      -- 'proc:3.1.2'
  kind       TEXT NOT NULL,      -- 'kafka' | 'declared'
  via_node   TEXT,               -- 'topic:orders.matched.v1'; NULL when declared
  via        TEXT NOT NULL,      -- 'interaction' | 'rollup'
  declared   INTEGER NOT NULL DEFAULT 0,
  derived    INTEGER NOT NULL DEFAULT 0,
  support    TEXT NOT NULL,      -- 'kafka' | 'component' | 'none'  (see §5)
  cross_team INTEGER NOT NULL DEFAULT 0,
  note       TEXT,               -- the author's, when declared
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS process_links_from ON process_links (from_id);
CREATE INDEX IF NOT EXISTS process_links_to   ON process_links (to_id);

-- ───────────────── which teams a process reaches, and how. Rebuilt whole.
CREATE TABLE IF NOT EXISTS process_teams (
  process_id TEXT NOT NULL,
  team_id    TEXT NOT NULL,
  via        TEXT NOT NULL,   -- 'owner' | 'component' | 'handoff'
  via_node   TEXT,            -- the component that reaches it, when via='component'
  PRIMARY KEY (process_id, team_id, via, via_node)
);
CREATE INDEX IF NOT EXISTS process_teams_team ON process_teams (team_id);
```

`process_links` carries `declared` and `derived` as two flags on one row rather
than two rows, so a handoff that is both agreed reads as one fact. `first_seen`
survives a rebuild the same way `edges.first_seen` does.

`process_teams` exists so that "which teams does this process cross" and the
team × team matrix are each one query rather than a join per row. It is derived,
never authored, and rebuilt whole on every link pass.

---

## 4 · Ingest

**The registry is not ingested; it is loaded.** `teams.json` is read by the link
pass on every run — the same read that `repos.json` gets on every request — and
`departments`/`teams` are rebuilt from it. There is no manifest for it, no
quarantine and no supersession: it is a file the repository owns, and if it is
malformed the app says so and carries on with no registry rather than refusing to
start.

**Packs gain nothing at ingest time.** `handsOffTo` is stored inside
`process_packs.raw` and read back by the link pass, exactly as `touches` is
(SPEC-PROCESSES §3 refused a column for `touches` on the grounds that only the
link pass consumes it; the same argument holds here, and consistency is worth
more than a column).

**A `handsOffTo` never creates a process.** A declaration naming a code nobody
has written is a finding, never a row in `processes`. This is SPEC-PROCESSES
§12.1 applied one level up: a pack may not bring a process into existence any
more than it may bring a component into existence.

---

## 5 · The link pass

Everything here is global, deterministic and rebuilt from scratch on every pass,
in `server/src/link.js`, after the existing Layer B rollup.

### Team resolution

`nodes.team_id`, in order, first match wins:

1. **Its own.** A service whose manifest gave it a `team`. An override with
   `field='team'` counts here and beats the manifest, because a human correction
   outranks a scan — SPEC.md §15.4.
2. **Its owner's.** Anything with an `owner_repo` takes the team of that repo's
   service. This is what gives topics, databases and endpoints a team without
   anybody authoring one: `db:postgres/orders` is trading because order-service
   owns it, and `api:pricing-service/GET /v1/rates/{}` is trading because
   pricing-service exposes it.
3. **Its single writer.** A node with no owner that exactly one service writes to
   (`db.write` or `cache.write`) takes that service's team. This is what gives
   caches a team; `db.owns` has no cache equivalent. **Exactly one** — two
   writers and it stays teamless, because guessing between them would be worse
   than saying nothing.
4. Otherwise **none**, and that is frequently correct. An external is somebody
   else's by definition. A contract is a payload, not a thing a team runs. A
   topic nobody produces has no owner to inherit from — which is already a
   `no-producer` finding and does not need a second one.

`processes.team_id` is simply `teamId(owner)`, or NULL.

Every team id either resolution produces gets a `teams` row if it does not have
one, with `registered=0` and `name` taken from the raw string.

### Handoff derivation

Rebuild `process_links` whole:

1. **Derived, Kafka only.** For every pair where A's interaction is
   `kafka.produce` and B's is `kafka.consume` **naming the same topic**, write a
   row with `kind='kafka'`, `via_node` the topic, `via='interaction'`,
   `derived=1`, `support='kafka'`.

   Note the direction trap: both interactions are stored service-centric, so the
   topic is in `to` for a produce **and** in `to` for a consume. `flowDirection()`
   exists because of this; do not reach for `from` on a consume.

   Do **not** derive from `http.call`, `db.*` or `cache.*`. §1 says why, and the
   number to remember is twenty-five: that is how many wrong links the obvious
   HTTP rule produces on the demo estate.

2. **Declared.** For every `handsOffTo` on every process in every active pack,
   write a row with `kind='declared'`, `declared=1`, `via_node` NULL,
   `via='interaction'`, and the author's `note`. When a derived row already
   exists for the same pair, set `declared=1` on **that** row instead of writing
   a second one — the two agree, and agreement is one fact.

3. **Support.** For every row with `declared=1` and `derived=0`, decide how much
   the topology corroborates the claim:
   - `component` — the two processes share at least one component (their
     `process_components` intersect). The author says there is a handoff and the
     two processes demonstrably touch the same thing; that is plausible and not
     worth reporting.
   - `none` — they share nothing at all. That is a claim with nothing behind it,
     and it is `process-link-unsupported`.

   A declared handoff over HTTP lands on `component` — the caller touches the
   endpoint and the callee's process touches the service that exposes it — which
   is exactly the behaviour that stops the finding from crying wolf on every
   synchronous handoff an author writes down.

4. **Rollup.** A handoff between two leaves is also a handoff between their
   ancestors, `via='rollup'`, **except** when the two ends are the same process
   or one is an ancestor of the other. Without that exception an internal handoff
   inside `L2` would roll up into `L2 → L2`, and a level 1 would appear to hand
   off to itself.

5. `cross_team` is 1 when both ends have a `team_id` and they differ. A link with
   a teamless end is not cross-team; it is unknown, and claiming otherwise would
   let a missing `owner` masquerade as a boundary.

### Team reach

Rebuild `process_teams` whole, for every process at every level:

- `via='owner'` — its own `team_id`.
- `via='component'` — the team of every component in its `process_components`,
  with that component in `via_node`. Because `process_components` already rolls
  up, a level 1 gets the union of its children's for free.
- `via='handoff'` — the team at the other end of every `process_links` row it
  appears in.

This is where the HTTP case lives. `L2.1.3 Check the customer may trade` reaches
the identity team `via='component'`, `via_node='api:identity-service/GET
/v1/users/{}'` — which is true, where "hands off to L1.1.1" was false.

### New findings

Added to the existing `drift` table and `rebuildDrift()`, in the same voice.

| `kind` | Condition | Severity |
|---|---|---|
| `unknown-team` | a team id in use that is not in the registry | warn |
| `component-no-team` | a `service` with no team and no override giving it one | info |
| `process-no-owner` | a level 1 or 2 process with no `owner` | info |
| `process-link-unsupported` | a declared handoff whose two processes share nothing at all | warn |
| `process-link-unknown-target` | a declared handoff naming a code that does not exist | warn |
| `process-link-undocumented` | a derived cross-team handoff no pack declares | info |

Five judgement calls baked into that table:

**`unknown-team` fires only when a registry is loaded.** With no `teams.json`
every team is unregistered and the finding would report the whole organisation —
the same argument SPEC-PROCESSES §5 makes for `uncovered-component` against an
empty Layer B.

**`component-no-team` is for services only.** A contract, an external, an
unproduced topic and a two-writer cache are all legitimately teamless (§5), and
firing on them would bury the one case that is a real gap: a service nobody owns.

**`process-link-undocumented` is info, and cross-team only.** An internal handoff
between two of a team's own processes does not need writing down — the team knows.
A handoff that leaves the team and is in nobody's document is the one worth a
line, and on the demo estate that is a handful rather than a wall.

**`process-link-unsupported` needs `support='none'`, not `derived=0`.** A
declared HTTP handoff is never derived and must not therefore be reported; §5
step 3 is what keeps the finding honest.

**There is no `team-with-no-components` finding.** A team in the registry that
owns nothing in the estate is the normal case during a rollout — the user's own
situation is one team today and a department later — and flagging it would train
people to ignore the group.

---

## 6 · Search

Extend `rebuildSearch()`. One new subject kind:

- `team` — `title` is the team's display name; `body` carries the id, the name,
  the department, the description, the contact, and the id of every component and
  every process it owns.

Searching a team name must find the team. A process's existing `body` gains its
resolved team id and name, so searching a team name also finds that team's
processes.

---

## 7 · HTTP API

Ids and codes are query parameters, never path segments.

**`GET /api/teams`** — every team, registered or not, with `{id, name,
department, description, contact, registered}` and counts: components, processes,
handoffs out, handoffs in, teams depended on. Plus `departments` and
`configured: false` when there is no `teams.json`, exactly as `/api/repos` does.

**`GET /api/team?id=`** — one team: the team, its components, its processes, the
teams it reaches and how, and its handoffs in both directions.

**`GET /api/handoffs`** — every `process_links` row, with
`?crossTeam=true|false`, `?team=`, `?code=` and `?support=` filters, each end
resolved to `{code, name, team}` so a table needs no second round trip.

**`GET /api/process?code=`** gains `links: { out: [], in: [] }` and `teams: []`
— the process's `process_teams` rows, each with the component that reaches it.

**`GET /api/graph`** gains `?teams=` as a filter, and every node carries
`teamId` and `teamName`. `?process=` is unchanged and already correct.

**`GET /api/status`** gains `teams: { registered, unregistered, departments }`
and `handoffs: { total, crossTeam, undocumented }`.

---

## 8 · The UI

### The map, on the process page

A `Map` card on `/process?code=`, between the flow diagram and the components
list, rendering exactly `GET /api/graph?process=<code>` — the components of this
process and the edges among them, at every level. It answers what the sequence
diagram cannot: the shape, and where the edges leave the team.

`MapCanvas` currently takes `focus` and `depth` as props and reads the rest of
the filter from `useScope()`. It needs a way to be told "this process, and ignore
the filter row", because the process page has no filter row and must not pick up
whatever the map page was last set to. Add a prop; do not fork the component, and
do not reach into the scope from the page.

### Colour by kind, or by team — never both

`web/src/lib/nodes.ts` already maps node kind onto six of the eight categorical
slots in `theme.css`, and **`theme.css` may not be touched**. There is no second
palette, so a team cannot simply be another colour: one encoding has to win.

So the map gains a **Colour by** control — `Kind` (the default, unchanged) or
`Team`. Selecting `Team` re-tints the nodes by team and the legend lists the
teams on screen instead of the kinds. Kind is still readable from the node's
label and its shape. With more than eight teams on screen, the teams past the
eighth are drawn in the neutral border colour and the legend says so — the
tokens are documented as "fixed order, never cycled" and wrapping them round
would put two teams in one colour with nothing saying so.

### `/teams` and `/team?id=`

`/teams` — every team, by department, with its component and process counts and
its handoff counts. A team not in the registry is marked, because that is the
finding on screen rather than buried in Health.

`/team?id=` — one team: what it owns, what it runs, who it hands off to and who
hands off to it, and the teams it depends on with the component that reaches
each.

### The process page gains two cards

**Teams** — who owns this process, and which other teams it reaches, each with
the component or the handoff that reaches them. At level 1 this is the answer to
"how many teams does this process cross", which SPEC-PROCESSES §10 already asks
for and which currently has to be counted by eye off the services list.

**Handoffs** — out and in, each naming the other process, its team, what carries
it, and whether it is derived, declared or both. A declared handoff with
`support='none'` says so here as well as in Health, because the person reading
the process is the person who can fix it.

### Node detail gains a team

The node page's identity row already carries repo and team. It now links the team
to `/team?id=`, and says how the team was resolved — its own, its owner's, or its
writer's — because an inherited team is a weaker fact than a declared one and the
page should not pretend otherwise.

### New widgets

| type | what |
|---|---|
| `team-list` | teams with their counts, by department |
| `team-handoffs` | the team × team handoff matrix, counts in the cells |
| `process-handoffs` | one process's handoffs, in and out |
| `process-map` | the process subgraph, so it can go on a dashboard too |

The matrix is a `DataGrid` with a row per source team and a column per target,
not a bespoke chart — it is a table of counts, the house style has a table, and
a table is navigable.

---

## 9 · Build order

**Phase 12 — the registry.** `teams.json`, `teams.example.json`, the §3 org
tables, `teamId()`, the loader, derived `nodes.team_id` and `processes.team_id`,
and the three team findings. No UI.

**Phase 13 — handoffs.** The `handsOffTo` schema field, `process_links` and
`process_teams`, the §5 derivation, rollup and support rules, and the three link
findings. Still no UI; verifiable from the command line.

**Phase 14 — demo data and verification.** `teams.json` for Meridian, the
`handsOffTo` declarations and the deliberate defects in §11, and the verify
stages. **Do not start the UI until this passes.**

**Phase 15 — read API and the core pages.** §7 in full, then `/teams`,
`/team?id=`, the two new cards on the process page, and search.

**Phase 16 — the payoff.** The map on the process page, colour-by-team, the
Teams filter, the four widgets and a seeded Teams page.

Stopping after Phase 15 leaves something genuinely useful. Phase 16 is the
answer to what was actually asked for; do not start it on a broken Phase 15.

---

## 10 · Verification

Extend `server/scripts/verify.mjs` in the same style. Every assertion is
checkable without the real repositories.

**Phase 12**
- With no `teams.json`, `/api/teams` answers `configured: false`, lists the nine
  teams the data contains — the eight real ones and `risk-ops` — and
  `unknown-team` does not fire.
- With the demo `teams.json`, all eight are `registered=1` and sit in two
  departments.
- `teamId()` maps `Trading`, ` trading ` and `TRADING` to `trading`, and
  `Trading Team` to `trading-team` — it fixes case and separators and does not
  guess.
- `nodes.team_id` for `svc:order-service` is `trading` (its own), for
  `db:postgres/orders` is `trading` (its owner's), and for
  `api:pricing-service/GET /v1/rates/{}` is `trading` (its exposer's).
- An override setting a node's team beats the manifest, and a re-ingest of that
  repo does not revert it.
- `ext:stripe`, `contract:com.meridian.events.OrderMatched` and
  `topic:risk.flagged.v1` have **no** team, and `component-no-team` does not fire
  for any of them.
- Every demo service has a team, so `component-no-team` is 0.

**Phase 13**
- Exactly **6** derived handoffs, **5** of them `cross_team`. Count `via =
  'interaction'`; the rollup rows are the same facts one level up.
- `proc:2.3.2 → proc:3.1.2` exists, `kind='kafka'`,
  `via_node='topic:orders.matched.v1'`, `derived=1`.
- Rolled up, `proc:2 → proc:3` exists and `proc:2 → proc:2` does **not** — the
  internal handoff `2.2.3 → 2.2.4` must not become a self-link.
- Ingesting a pack creates no rows in `nodes` or `edges` — still. Assert it
  again; `handsOffTo` is the most likely thing to break it.
- A declared handoff to a process that exists and shares a component gets
  `support='component'` and raises nothing.
- `process_teams` for `proc:2.1.3` contains `identity` `via='component'` with
  `via_node='api:identity-service/GET /v1/users/{}'`.

**Phase 14** — after `npm run seed:demo`:

Counted over the **direct** handoffs — `via='interaction'` — because the
rolled-up rows are the same facts restated at a higher level and counting them
would mean nothing.

| | expected |
|---|---|
| departments | 2 |
| teams, registered | 8 |
| teams, unregistered | 1 — `risk-ops`, §11 |
| `handsOffTo` declarations in the packs | 6 |
| derived handoffs | 6 |
| …of them crossing a team | 5 |
| declared handoffs that became a row | 5 — the sixth names a process that does not exist |
| …agreed, `declared=1 derived=1` | 4 |
| direct handoffs crossing a team | 6 — the five derived, plus the declared payments → growth |
| rows after rollup | 34 — 6 derived plus 19 of their rollups, and the declared-only link plus the 8 ancestor pairs it rolls into |
| `support='none'` | exactly 1 |
| `unknown-team` | exactly 1 |
| `component-no-team` | 0 |
| `process-no-owner` | 0 |
| `process-link-unsupported` | exactly 1 |
| `process-link-unknown-target` | exactly 1 |
| `process-link-undocumented` | exactly 1 |
| distinct team pairs in `process_teams`, at leaf level | 13 |
| …across all levels, where the rollup widens them | 22 |

- `GET /api/process?code=2` reports more than one team, from `process_teams`
  rather than by eye.
- `GET /api/team?id=trading` lists its components, its processes and both
  directions of its handoffs.
- Removing the demo clears `process_links`, `process_teams` and every Layer C
  finding.
- **`npm run verify` still passes every existing Layer A and Layer B
  assertion.**

**Phase 15**
- Searching a team name finds the team and that team's processes.
- A process whose `handsOffTo` names a missing code renders the claim and marks
  it, rather than dropping it.

**Phase 16**
- The process page's map shows exactly the component count `GET /api/process`
  reports, at all three levels.
- Colouring by team re-tints the map and the legend lists teams; colouring by
  kind restores exactly the previous colours.
- Dark mode is legible on every new screen; no horizontal page scroll at 1280px.

---

## 11 · The demo data

### `teams.json`

Meridian's eight existing teams — `trading`, `identity`, `wallet`, `ledger`,
`payments`, `platform`, `data`, `growth` — in **two** departments, so the
grouping is exercised rather than asserted:

| department | teams |
|---|---|
| `trading-platform` Trading Platform | trading, wallet, ledger, payments, identity, platform |
| `data-and-growth` Data and Growth | data, growth |

Written to `teams.json` by `npm run seed:demo` and removed by `--remove --files`,
exactly as the manifests and packs are, so what is committed is what is verified.

### The declarations

Five of the six derived Kafka handoffs are declared in the packs, so they read as
agreed. The sixth — `2.3.5 → 3.1.3`, wallet to data over
`wallet.balance.changed.v1` — is left undeclared, giving exactly one
`process-link-undocumented`.

### The three deliberate defects

Each is one line of pack and each demonstrates one finding. None stacks on top of
an existing Layer B defect, and — per SPEC-PROCESSES §11 — **none of them is in
`schema/example.order-and-execution.json`**, which stays the clean fixture. That
pack gains only the two exemplary declarations, which is where the field should
be shown off.

1. **A handoff to a process nobody has written.** `1.2.3 Enable trading on the
   wallet` declares it hands off to `L4.1`, the risk team's monitoring process,
   whose pack does not exist → `process-link-unknown-target`. The common real
   case: the team at the other end is not on the map yet.
2. **A handoff with nothing behind it.** `1.3.2 Record the payment` declares it
   hands off to `2.4.2 Send the message`, and the two share no component at all
   → `process-link-unsupported`. Payments used to notify the customer itself,
   before the balance-change event existed; the handoff was real, was replaced,
   and the document was left behind. That is what this finding is for, and it is
   why the rule is `support='none'` rather than `derived=0` — a handoff that is
   merely not Kafka is not a defect.
3. **A team nobody registered.** `1.2.1 Record the verification result` is owned
   by `risk-ops`, which is not in `teams.json` → exactly one `unknown-team`. KYC
   decisioning moved to Risk and Controls and nobody updated the registry.

That third one is why the leaf-level team-pair count is 13 rather than 12: a
process owned by a team that owns no components reaches its own former team
through every component it touches.

---

## 12 · Invariants

On top of SPEC.md §15 and SPEC-PROCESSES.md §12, which all still hold:

1. **A team never becomes a node.** Teams are an attribute of components and
   processes, never members of the estate. Nothing in `nodes` comes from
   `teams.json`.
2. **A pack never creates a process.** `handsOffTo` naming an unknown code is a
   finding, exactly as a `touches` naming an unknown component is.
3. **Handoffs are derived from Kafka alone.** A synchronous call is a dependency
   on a team, not a handoff to a process. Do not generalise the rule.
4. **`team_id` is derived and `team`/`owner` are evidence.** Never overwrite what
   the manifest or the pack said; resolve alongside it.
5. **A human override outranks a derived team**, as it outranks everything else.
6. **A handoff never rolls up into a self-link.** Same process, or ancestor and
   descendant, means no row.
7. **The registry is a file, not an ingest.** No manifest, no quarantine, no
   supersession. Absent, the app works and says `configured: false`.
8. **`teamId()` is one rule in one place.** It normalises case and separators and
   never guesses that two different strings meant the same team.
9. **Layer A and Layer B stay independently correct.** Every existing assertion
   in SPEC.md §14 and SPEC-PROCESSES.md §10 must still pass. `npm run verify` is
   the gate.
