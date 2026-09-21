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

- **Handoffs are derived from Kafka only.** Eight on the demo estate, seven of
  them crossing a team. Rolled up, they say `L2 Order and execution` hands off to
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
      "contact": "#meridian-trading",
      "aliases": ["trading-team", "j-smith"] }
  ]
}
```

`id` is the canonical team id and the thing everything joins on. `department` is
optional and references a `departments[].id`. `description` and `contact` are for
the team page. `aliases` is optional and is covered below.

### Aliases, and the registry as something you edit

A scan derives a team from whatever the commit history says, so an estate
arrives with teams named after people and the same team spelt four ways. That
has to be fixable, and it has to be fixable **once** — not in forty manifests,
and not again after the next scan.

`aliases` is a list of ids that mean this team and are not a team of their own.
Everything that reads a team *out of the data* — a manifest's `service.team`, a
pack's `owner`, a human's `overrides` row — resolves `teamId()` through the
aliases before joining. A spelling listed here never gets a `teams` row, never
reaches `/api/teams`, and never fires `unknown-team`.

**A merge is an alias and nothing else.** Nothing is rewritten and nothing is
deleted: the manifests still say what the scan found, and the registry now says
what that meant. Deleting the alias undoes it, and the team comes back wherever
the data still spells it that way. This is what `teamId()`'s own rule already
implies — *the registry, not a heuristic, is what says one name was meant to be
another* — made writable.

**A rename may move the id, and only when the id came from the name.** `id` is
derived from the name for a team the registry has never seen, so renaming
`john-smith` to "Payments" moves it to `payments` and keeps `john-smith` as an
alias. An entry whose author deliberately gave `platform` the name "Platform
Engineering" has already said the two are not the same thing, so that one keeps
its id. The editor says which will happen before the request is sent.

**Alias rules, checked like everything else in the file.** An alias that is also
a team entry's id is the registry contradicting itself: the entry wins and a
problem is reported. The same alias on two teams stays with the first — unlike a
duplicate *entry*, where the later wins, because an entry is a statement about
one team and the last edit is the current one, while a second team claiming
somebody else's alias is a team taking what it was not given. An entry aliasing
its own id is a no-op, not a mistake.

**The server writes this file.** Through a temporary file and an atomic rename,
carrying every key it did not recognise through untouched — somebody hand-editing
`teams.json` and somebody renaming a team on the Teams page are editing the same
file, and neither may silently drop the other's work. A file that exists and is
not readable JSON is never written: the edit would be applied to `{}` and
everything in it would be lost, so the request is refused and says so. An absent
file is fine, and writing one is how a deployment gets its first registry.

**The registry checks itself.** `teamId()` collapsing two spellings into one
team is the point of it, but two *entries* meaning one team is a mistake in the
file rather than a merge the author asked for — and it used to happen silently,
last writer winning. Same for a `department` no department entry declares. These
are problems with a file, not the estate disagreeing with itself, so they are
not `drift`: `/api/teams` carries a `problems` array and the Teams page renders
it, which is the page somebody would be on when they fixed it.

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
  registered    INTEGER NOT NULL DEFAULT 0, -- 1 = in teams.json, 0 = seen in data only
  source        TEXT NOT NULL DEFAULT 'process'  -- registry | component | process
);

-- A spelling that means a team rather than a team of its own. Rebuilt whole
-- beside `teams`, from `teams.json` alone: nothing here is derived and nothing
-- may be inferred into it.
CREATE TABLE IF NOT EXISTS team_aliases (
  alias   TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE
);
```

`registered` is the whole point of the table. A team that appears in the data but
not in the registry still gets a row, so every screen can name it — it is simply
marked as not registered, which is what `unknown-team` reports. A team that is
only an *alias* gets no row at all, which is what makes a merge look like a
merge rather than like two teams one of which owns nothing.

```sql
-- ───────────────────────────── derived team on everything, by the link pass
ALTER TABLE nodes     ADD COLUMN team_id  TEXT;  -- derived, see §5
ALTER TABLE processes ADD COLUMN team_id  TEXT;  -- derived from `owner`, or inherited
ALTER TABLE processes ADD COLUMN team_via TEXT;  -- 'owner' | 'inherited'
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
  from_team_id TEXT,             -- the LEAF pair's teams, carried into every
  to_team_id   TEXT,             -- rollup of this row. See §5 rule 5.
  cross_team INTEGER NOT NULL DEFAULT 0,
  from_edge_id TEXT,             -- the publish and the consume the derivation
  to_edge_id   TEXT,             -- matched, so a derived handoff cites the code
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

**The link pass has two inputs that are not an ingest.** It reads `overrides`
(`field='team'`) and `teams.json`, and neither arrives through the inbox. So
`PUT` and `DELETE /api/override` run the link pass and rebuild the search index
before answering, and `POST /api/relink` exists for the case the server cannot
see: somebody edited `teams.json`. Writing an override and stopping would leave
`/api/node` showing the correction — overrides are applied at read time — while
every derived team column still said the old thing, so `?teams=` and the team
lens would disagree with the page.

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

   Read the team off the **active manifest's body**, not off `nodes.team`. The
   node upsert is COALESCE-based, so a column never clears: a service whose next
   manifest drops `service.team` would keep the old one for ever, and
   `component-no-team` could never fire for a service that once had one. The
   manifest is the evidence, so the manifest is what is read — the same pattern
   `touches` and `handsOffTo` use.

2. **Its owners', when they agree.** A node claimed by `db.owns`, `http.expose`
   or `kafka.produce` takes the team behind those claims when there is **exactly
   one**. This is what gives topics, databases and endpoints a team without
   anybody authoring one: `db:postgres/orders` is trading because order-service
   owns it.

   Exactly one, and this matters. `owner_repo` is decided by first-claim-by-
   `first_seen` with the repo name as a tiebreak, and DECISIONS.md adopted that
   rule *because* fan-in onto a topic is not a defect — the winner was never
   meant to mean anything. Reading it as "this team owns this topic" would
   promote an ingest-order tiebreak into an org fact, colour the node and decide
   whose filter it appears under. `topic:notifications.requested.v1` is published
   by trading and payments, so it has no team, and `multi-team-topic` says so.

3. **Its single writing team.** A node with no owner that exactly one **team**
   writes to (`db.write` or `cache.write`) takes that team. This is what gives
   caches a team; `db.owns` has no cache equivalent. One team rather than one
   service, so two services of the same team writing a cache still resolves.

4. Otherwise **none**, and that is frequently correct. An external is somebody
   else's by definition. A contract is a payload, not a thing a team runs. A
   topic nobody produces has no owner to inherit from — which is already a
   `no-producer` finding and does not need a second one. `cache:redis/session` is
   written by two teams and so has none.

`processes.team_id` is `teamId(owner)`, else the **nearest ancestor's**, with
`team_via` recording which. A leaf inside a stage owned by trading is trading
unless it says otherwise, which is what a reader assumes. Without the
inheritance a teamless leaf drops out of every team view and poisons
`cross_team` on every handoff it takes part in — while `process-no-owner`
deliberately does not fire for a leaf, so nothing would ever say why.

Every team id either resolution produces gets a `teams` row if it does not have
one, with `registered=0` and `name` taken from the raw string.

### Handoff derivation

Rebuild `process_links` whole:

1. **Derived, Kafka only, and checked against the topology.** The publish side
   is a process whose interaction is a resolved `kafka.produce` on topic T. The
   consume side is a process that either says so in its interaction, **or** names
   T in `touches` while the topology contains the consuming edge
   `(B.node, kafka.consume, T)`. Write `kind='kafka'`, `via_node` the topic,
   `via='interaction'`, `derived=1`, `support='kafka'`, and the two edge ids.

   That second clause is not a loosening. SPEC-PROCESSES §3 blesses a leaf
   spending its one interaction slot on what it *does* with the message and
   naming the topic in `touches`, so reading only the interaction made the answer
   depend on which of two equally true facts the author wrote where. On the demo
   estate it is the difference between six handoffs and eight: `2.3.3 Post the
   trade to the ledger` and `1.1.3 Open the wallets` are both real cross-team
   handoffs that the narrow rule loses. The topology check is what keeps it a
   fact — `2.3.4` also names `orders.matched.v1` in `touches` and has no
   consuming edge, so it produces nothing.

   Note the direction trap: both interactions are stored service-centric, so the
   topic is in `to` for a produce **and** in `to` for a consume. `flowDirection()`
   exists because of this; do not reach for `from` on a consume.

   Do **not** derive from `http.call`, `db.*` or `cache.*`. §1 says why, and the
   number to remember is twenty-five: that is how many wrong links the obvious
   HTTP rule produces on the demo estate.

2. **Rollup, before the declarations are matched.** A handoff between two leaves
   is also a handoff between their ancestors, `via='rollup'`, **except** when the
   two ends are the same process or one is an ancestor of the other. Without that
   exception an internal handoff inside `L2` would roll up into `L2 → L2`, and a
   level 1 would appear to hand off to itself.

   Rolling up first is what lets a declaration written at **any** level find its
   derived counterpart. Agreement is a property of the pair, not of whichever row
   happened to exist when the declaration was read.

3. **Declared.** For every `handsOffTo` on every process in every active pack:
   when the topology has any row for that pair, set `declared=1` and the `note`
   on **every** one of them — a pair is agreed or it is not. Only when there is
   nothing at all for the pair, write a row with `kind='declared'`, `via_node`
   NULL, `via='interaction'`. Then roll the new rows up in turn.

4. **Support**, for a declared row the topology does not derive:
   - `component` — the two processes share a **directly named** component. Their
     `process_components` rows with `via <> 'rollup'`, not the rolled-up set:
     `process_components` rolls up, so an L1's set is its whole subtree's and
     almost any two of them intersect. On the demo estate every ordered pair of
     level 1s shares something, which would make the finding below dead above
     level 3 — exactly where a declared handoff between two big processes is
     most likely to be stale.
   - `none` — they share nothing. A claim with nothing behind it, and it is
     `process-link-unsupported`.

   A declared handoff over HTTP lands on `component` — the caller directly names
   the endpoint and the callee directly names the service that exposes it, which
   `via='exposes'` is not a rollup of — which is exactly what stops the finding
   crying wolf on every synchronous handoff an author writes down.

5. `cross_team` comes from `from_team_id`/`to_team_id`: the teams of the **leaf
   pair**, carried unchanged into every rollup of the row. A rolled-up row's own
   ends are ancestors, whose owners are frequently different teams from the
   children doing the work — reading the row's ends would attribute the handoff
   to a team that never touched it and put a pair in the team matrix that never
   happened. `2.3.5 → 2.4.1` is wallet → growth; rolled up to `2.3 → 2.4` the
   row's own ends say trading → growth, and wallet → growth is the truth.

   Both ends must have a team. A link with a teamless end is not cross-team; it
   is unknown, and claiming otherwise would let a missing `owner` masquerade as a
   boundary. With the inheritance above that is rare, and when it happens
   `process-no-owner` reports it at the level that matters.

**Every count, and every one of the three link findings below, is computed over
`via='interaction'` rows.** The rolled-up rows are the same facts restated a
level up; counting them would put three in the trading → data cell of the matrix
for one handoff, and fire the same finding once per ancestor pair. They exist for
the process page's Handoffs card and for nothing else.

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
| `component-no-team` | a **non-orphan** `service` with no team | info |
| `multi-team-topic` | a topic published by more than one team, so no team owns it | info |
| `process-no-owner` | a level 1 or 2 process with no `owner` | info |
| `process-link-unsupported` | a declared handoff whose two processes share nothing at all | warn |
| `process-link-unknown-target` | a declared handoff naming a code that does not exist | warn |
| `process-link-undocumented` | a derived cross-team handoff no pack declares | info |

Five judgement calls baked into that table:

**`unknown-team` fires only when a registry is loaded.** With no `teams.json`
every team is unregistered and the finding would report the whole organisation —
the same argument SPEC-PROCESSES §5 makes for `uncovered-component` against an
empty Layer B.

**`component-no-team` is for non-orphan services only.** A contract, an
external, an unproduced topic, a fan-in topic and a two-writer cache are all
legitimately teamless (§5), and firing on them would bury the one case that is a
real gap: a service nobody owns. An **orphan** service is excluded for the same
reason an external is: `createOrphans()` invents it for a service referenced by
an edge and never scanned, so it has no manifest, no team, and no remedy short of
scanning a repository the reader does not have. That is the trap
`uncovered-component` already guards against.

**`process-link-undocumented` is info, and cross-team only.** An internal handoff
between two of a team's own processes does not need writing down — the team knows.
A handoff that leaves the team and is in nobody's document is the one worth a
line, and on the demo estate that is a handful rather than a wall.

**`process-link-unsupported` needs `support='none'`, not `derived=0`.** A
declared HTTP handoff is never derived and must not therefore be reported; §5
step 3 is what keeps the finding honest.

**`multi-team-topic` is the explanation for a grey topic.** Layer A deliberately
raises nothing for fan-in onto a topic, because several producers is not a defect
— but §5 rule 2 then leaves the topic teamless, so it is grey on the team lens
and absent from every team's filter with nothing saying why. Two teams sharing a
publish is also a real coordination fact: a change to what goes on that topic is
a conversation rather than a decision.

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
department, description, contact, registered, aliases}` and counts: components, processes,
handoffs out, handoffs in, teams depended on. Plus `departments` and
`configured: false` when there is no `teams.json`, exactly as `/api/repos` does.

**`GET /api/team?id=`** — one team: the team, its components, its processes, the
teams it reaches and how, and its handoffs in both directions. `id` resolves
through the aliases, so a link, a bookmark or a saved filter written before a
merge still lands on the team that absorbed it.

**`PUT /api/team`** — `{id, name?, department?, description?, contact?}`.
Upserts the registry entry, creating one for a team that only the data knew
about. A `department` that names nothing yet is created. Answers `{id, renamed}`
with the id the team ended up at, which may not be the one it started with; a
name that is already another team's is refused with `409` and the id it clashed
with, because a rename that quietly folded two teams together would be a merge
nobody asked for.

**`POST /api/team/merge`** — `{from, into}`. `into` gains `from`'s id as an
alias, and `from`'s aliases too, so a chain of merges loses nothing halfway
along. `from`'s entry is removed. Both ends resolve through the aliases, so
merging into an already-merged team lands on the survivor.

**`DELETE /api/team/alias?alias=`** — removes one alias wherever it is held.
This is the undo for a merge.

All three write `teams.json` and then run the link pass, for the reason §4
already gives for an override: the pass reads the registry and every derived
team column comes out of the pass.

**`GET /api/nodes`** and **`GET /api/node`** carry `teamVia`: `scan` when the
manifest named a team, `inherited` when it came from whatever owns the node,
`override` when somebody corrected it, and `null` for none. Without it there is
no visible difference between a team the scan found and a team a person typed,
and "revert to the scan" is a button that cannot say what it would undo.

**`GET /api/handoffs`** — every `process_links` row, with
`?crossTeam=true|false`, `?team=`, `?code=` and `?support=` filters, each end
resolved to `{code, name, team}` so a table needs no second round trip.

**`GET /api/process?code=`** gains `links: { out: [], in: [] }` and `teams: []`
— the process's `process_teams` rows, each with the component that reaches it.

**`GET /api/graph`** gains `?teams=` as a filter, and every node carries
`teamId` and `teamName`. `?process=` is unchanged and already correct.

**`GET /api/status`** gains `teams: { registered, unregistered, departments }`
and `handoffs: { total, crossTeam, undocumented }`, all counted over
`via='interaction'`.

**`POST /api/relink`** re-runs the link pass and the search rebuild, for when
`teams.json` has changed under the server. It answers with the team and handoff
counts so a caller can see it took effect.

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

**Handoffs** — three lists, not two. `out` and `in` are the rows where this
process is an end. `inside` is the rows whose **both** ends are descendants of
it, and without it a level 1 that crosses four teams shows no handoffs at all:
the rollup deliberately skips a pair where one end contains the other, so
`1.2.2 → 1.2.3` (identity → wallet) and `1.3.3 → 1.3.4` (payments → ledger) —
both cross-team, both inside `L1` — would vanish from the page of the process
that contains them.

Each names the other process, its team, what carries it, and whether it is
derived, declared or both. A derived one links to the evidence behind its two
edges, because that is what makes it a fact rather than a claim. A declared one
with `support='none'` says so here as well as in Health, because the person
reading the process is the person who can fix it.

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
- With the demo `teams.json`, all eight are `registered=1`, they sit in two
  departments, and `/api/teams` reports no problems with the file.
- A registry with two entries meaning one team, a `department` nothing declares,
  and an entry with no usable id reports exactly those three and nothing else.
- `teamId()` maps `Trading`, ` trading ` and `TRADING` to `trading`, and
  `Trading Team` to `trading-team` — it fixes case and separators and does not
  guess.
- `nodes.team_id` for `svc:order-service` is `trading` (its own), for
  `db:postgres/orders` is `trading` (its owner's), and for
  `api:pricing-service/GET /v1/rates/{}` is `trading` (its exposer's).
- `topic:notifications.requested.v1`, published by trading and payments, has
  **no** team, and raises exactly one `multi-team-topic`.
- `cache:redis/pricing-quotes` takes `trading` from its single writing team;
  `cache:redis/session`, written by two teams, has none.
- A leaf with no `owner` inherits its nearest ancestor's, with
  `team_via='inherited'`; a leaf that names one has `team_via='owner'`.
- An override setting a node's team beats the manifest, and a re-ingest of that
  repo does not revert it.
- `ext:stripe`, `contract:com.meridian.events.OrderMatched`,
  `topic:risk.flagged.v1` and `cache:redis/session` have **no** team, and
  `component-no-team` does not fire for any of them.
- Every demo service has a team, so `component-no-team` is 0.

**Phase 13**
- Exactly **8** derived handoffs, **7** of them `cross_team`. Count `via =
  'interaction'`; the rollup rows are the same facts one level up.
- Two of the eight come from the `touches` clause — `2.3.2 → 2.3.3` and
  `1.1.2 → 1.1.3` — and `2.3.4`, which names the same topic in `touches` with no
  consuming edge, produces none.
- `proc:2.3.2 → proc:3.1.2` exists, `kind='kafka'`,
  `via_node='topic:orders.matched.v1'`, `derived=1`, and carries the two edge
  ids the derivation matched.
- `proc:2.3 → proc:2.4` carries `from_team_id='wallet'`, not trading: the leaf
  pair's teams, not the row's own ends.
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
| `handsOffTo` declarations in the packs | 8 |
| direct handoffs | 9 |
| derived | 8 |
| …of them crossing a team | 7 |
| declared rows | 7 |
| …agreed, `declared=1 derived=1` | 6 |
| direct handoffs crossing a team | 8 — the seven derived, plus the declared payments → growth |
| rows after rollup | 36 |
| `support='none'` | exactly 1 |
| `unknown-team` | exactly 1 |
| `multi-team-topic` | exactly 1 — `notifications.requested.v1` |
| `component-no-team` | 0 |
| `process-no-owner` | 0 |
| `process-link-unsupported` | exactly 1 |
| `process-link-unknown-target` | exactly 1 |
| `process-link-undocumented` | exactly 1 |
| distinct team pairs in `process_teams`, at leaf level | 13 |
| …across all levels, where the rollup widens them | 22 |
| topics with a team | 7 of 9 |

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

Seven of the eight derived Kafka handoffs are declared in the packs, so they read
as agreed. The eighth — `2.3.5 → 3.1.3`, wallet to data over
`wallet.balance.changed.v1` — is left undeclared, giving exactly one
`process-link-undocumented`. `2.3.2` declares two, to the ledger and to
reporting, because one publish genuinely has two consumers and the schema should
be shown doing that.

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
3. **Handoffs are derived from Kafka alone, and always checked against the
   topology.** A synchronous call is a dependency on a team, not a handoff to a
   process. A `touches` entry counts only when the consuming edge exists. Do not
   generalise the rule.
4. **`team_id` is derived and `team`/`owner` are evidence.** Never overwrite what
   the manifest or the pack said; resolve alongside it.
5. **A human override outranks a derived team**, as it outranks everything else.
6. **A handoff never rolls up into a self-link.** Same process, or ancestor and
   descendant, means no row — and a rolled-up row carries the LEAF pair's teams,
   never its own ends'.
7. **Counts and findings read `via='interaction'`.** The rollup rows are the same
   facts one level up; counting them inflates every number and fires every
   finding once per ancestor pair.
8. **The registry is a file, not an ingest.** No manifest, no quarantine, no
   supersession. Absent, the app works and says `configured: false`.
9. **`teamId()` is one rule in one place.** It normalises case and separators and
   never guesses that two different strings meant the same team.
10. **Layer A and Layer B stay independently correct.** Every existing assertion
   in SPEC.md §14 and SPEC-PROCESSES.md §10 must still pass. `npm run verify` is
   the gate.
