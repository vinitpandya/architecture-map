# Handover

Three layers, all complete and verified.

**Layer A** — SPEC.md phases 1–6 — is the topology: what talks to what, derived
from code, with a file and a line behind every claim.

**Layer B** — SPEC-PROCESSES.md phases 7–11 — is what the business does: the
L1/L2/L3 hierarchy and the components each part of it runs through. Written by
people, and cross-checked against Layer A, which is where its value is.

**Layer C** — SPEC-ORG.md phases 12–16 — is who is responsible: a team on every
process and every component, from a registry rather than free text, and the
handoffs where one team's work ends and another's begins.

On top of those, the map reads at two detail levels: services with their
relationships collapsed into one line per pair, or the scan as it was stored.
Its key is a set of switches, and nodes can be dragged into an arrangement that
is saved, and a selection can isolate itself by hops when a screen has too many
lines to read. The team registry is editable from the Teams page, because a
scan derives a team from the commit history and an estate therefore arrives
with teams named after people. A process draws five ways — sequence, flow,
lanes, handoffs and decomposition — all from the same rows, because the
children are the flow. And the map draws itself four ways, or as a chord when
the topology is a hairball and only the traffic still reads.

Between B and C a polish pass read the whole result back against the spec and
found defects on paths the demo data never reaches. That turned out to be the
most productive thing in the build, and it is why §"Nothing is failing" below is
as long as it is.

A later pass did the same thing against *scale* rather than the spec, by
building a synthetic estate shaped like a real one and measuring. It found that
the map does not survive a real estate at all — see §"What the scale pass
found" — along with a filter row that silently did nothing on four screens, a
finding table that could not age or be closed, and two defects of my own. All
are fixed and verified.

Read [DECISIONS.md](DECISIONS.md) alongside this. It has the working for every
judgement call, including three places where a spec contradicts itself and how
each was resolved.

## Run it

```bash
npm install
npm run seed:demo     # ten services, 92 links, three process packs, 46 processes
npm run dev           # UI http://localhost:5173 · API http://localhost:8787
```

```bash
npm run verify                       # §14, SPEC-PROCESSES §10 and SPEC-ORG §10 — 543 assertions
npm run build && npm run verify:ui   # the checks that need a browser — 220 more
npm run verify:dev                   # the 11 that only fail in dev mode
npm run seed:demo -- --remove        # clear the demo estate and its packs out of the database
npm run validate -- <file>           # routes by shape: manifest or process pack
npm run prompts                      # rebuild prompts/standalone/ from prompts/ and schema/
npm run build && npm start           # production build, UI and API on one port
```

Both verify scripts run against throwaway databases under `data/`. Neither
touches your own, and neither modifies the working tree — `--remove` clears the
database and leaves the committed fixtures under `demo/` alone unless you add
`--files`.

## Mapping something real

[`prompts/standalone/`](prompts/standalone/) is the thing to hand somebody:
two prompts with their schemas and a worked example of each, self-contained, no
app needed. It exists because the prompts in `prompts/` are templates that only
render through `GET /api/prompt` — right for the Scan page and wrong for the
bootstrap, since you need manifests before the map is useful.

They are **generated** by `npm run prompts` and `npm run verify` fails if a
schema is edited without rebuilding them. A hand-maintained copy of a schema
that has drifted from the real one is precisely the failure this project is
built to detect, and shipping one in the onboarding material would be a poor
joke.

## Phases

| Phase | State |
|---|---|
| 1 · topology upsert | Complete, verified |
| 2 · link pass and drift | Complete, verified |
| 3 · demo estate | Complete, verified |
| 4 · search index | Complete, verified |
| 5 · the map | Complete, verified in a browser |
| 6 · finish | Complete |
| 7 · process pack schema and ingest | Complete, verified |
| 8 · rollup and process findings | Complete, verified |
| 9 · demo process packs | Complete, verified |
| 10 · read API and the core pages | Complete, verified |
| 11 · the map overlay, the flow view, the widgets | Complete, verified in a browser |
| polish · seven defects from an adversarial read | Complete, verified |
| 12 · the team registry, and a team on every component | Complete, verified |
| 13 · handoffs between processes | Complete, verified |
| 14 · the demo registry, declarations and defects | Complete, verified |
| 15 · the read API, /teams, /team, the process cards | Complete, verified |
| 16 · the map on the process page, colour by team, the widgets | Complete, verified in a browser |
| map · two detail levels, the key as a switch, drag to arrange | Complete, verified in a browser |
| teams · rename, merge, and a team on every service | Complete, verified in a browser |
| diagrams · five views of a process, and `next` in the schema | Complete, verified in a browser |
| map · isolate by hops, four arrangements, a chord view | Complete, verified in a browser |

Beyond §13 and §9's lists, two things the shells had not met: node detail renders
per kind (the topic page — producers against consumers with the version skew
flagged — is the good one), and drift is grouped findings that expand to the
participating parties and the code that proves each, rather than a table.

## What was actually run

**`npm run verify` — 543 assertions across seven stages, all passing.**

*Ingest (58, in-process against a fresh database, with a short HTTP stretch at
the end for the two routes an operator drives; `migrate` is its own stage and
is described under "A process code belongs to its pack").* `prompts/standalone/` is in
sync with the schemas it inlines, carries no unfilled placeholder, and has the
README, both schemas and both worked examples beside it — the check that stops
somebody being handed a copy of a schema that has quietly drifted.

A fresh install answers
`coverage` as two numbers rather than `{total: 0, covered: null}`, which is what
SQLite's SUM over zero rows gives you. `validate.mjs` exits 0 on the example and
1 on a `kind` typo naming `/edges/0/kind`. A quarantined manifest
leaves one row and zero nodes, edges and evidence. Re-ingesting leaves one active
manifest, doubles nothing, and leaves every `edges.id` and `first_seen`
unchanged when the manifest's edges and evidence are reordered. The contract
version is in `contract_bindings`, not on the node.

Then the import rules, which are the part of ingest the author actually hit. A
second service scanned out of the same repository leaves both manifests active,
the first service's seven edges and its evidence intact; re-scanning one
supersedes only its own. A scan asserting two edges where the last asserted
seven is refused, naming the five it would have lost, leaving the previous scan
active and raising one `scan-refused` finding against the service — and
`force` applies it, after which the finding goes. A second repo cannot change
the `kind` of a node it does not own, and the disagreement is reported with both
repos named. Over HTTP: `POST /ingest` refuses, `GET /manifests` marks that row
applicable and the schema-invalid one not, `POST /ingest/force` applies the
stored body, and an id that is not there is a 404 rather than a throw.

*The estate (74, over HTTP).* Every §14 count — 10 services, 9 topics, 5
contracts, 6 endpoints, 8 databases, 2 caches, 3 externals, 0 quarantined, 3
unresolved. Exactly one `no-producer` (`topic:risk.flagged.v1`), exactly one
`shared-database` (`db:postgres/ledger`), three `version-skew` including
`OrderMatched` at 3.2.0 vs 2.8.1 and `UserCreated` at 3.2.0 vs 3.0.0, zero
`multiple-owners`. `/api/graph?focus=svc:order-service&depth=1` returns 11 nodes,
all adjacent, with every kind asked for — and 10 without, because §8 makes
contracts opt-in. `?repos=` narrows to that repo and an unknown repo is empty
rather than everything. A repeated `?kind=` is 200 and means both. A malformed
override is a 400 that writes nothing. Five searches including `@KafkaListener` and `GET /v1/rates/{}`
return hits rather than an FTS5 syntax error. **An override changes
`/api/node` and a re-ingest of that repo does not revert it** — the single most
important test in the suite.

`/nodes`, `/edges` and `/unresolved` each narrow by repo, and an edge's repo is
the manifest that saw the call rather than either end's owner. A service
publishing v1 and v2 of one topic raises no `near-miss` while both versions stay
on the map — the demo estate carries no two-version pair, which is exactly why
that defect went unseen, so the pair is ingested on purpose. And a finding keeps
the moment it was first seen across a rebuild while `last_seen` moves, can be
accepted with a reason and reopened, survives a rebuild in either state, and
refuses a fingerprint nothing matches (404) or a state that is neither (400).

*Processes (96, over HTTP).* `validate.mjs` says which schema it picked. A
four-segment code exits 1 naming the path, quarantines the pack and imports zero
processes. An all-`L`-prefixed copy ingests onto the same rows. **Ingesting a
pack creates no rows in `nodes` or `edges`** — asserted before and after, and the
invariant that matters most. `proc:2.1.1` is level 3, parent `proc:2.1`,
sort_key `0002.0001.0001`; all 15 of the example's leaves resolve to an edge.
`sort_key` orders 2.9 before 2.10 where the code orders it after. `proc:2`'s
components are a superset of every descendant's; `proc:2.1.2` reaches
pricing-service via `exposes` because it calls its endpoint. Every §10 Phase 9
number: 3 packs, 46 processes at 3/9/34, one missing component from 3.1.1 for
`topic:trades.enriched.v1`, one missing interaction from 3.2.3, zero
orphan/duplicate/no-detail codes, exactly two uncovered topics, no service
without a process. `code=L2` reads the same process as `code=2`. Searching
`2.3.3`, `L2.3.3` and `orders.matched.v1` all work. A pack-only ingest moves
`lastIngestAt`, so the four screens that key their refresh on it do refresh.
`kind:process` narrows to processes rather than returning nothing. The authoring
prompt keeps its placeholder legend, carries the schema exactly once, and comes back with
every placeholder in its body filled — the pack id, the components and the codes
already taken.

A step with no branches stores none; a decision stores one row per arm, in the
order it was written, resolved to what each arm continues at; an arm that stops
the process stores its outcome and continues to nothing. A branch to a code
nobody wrote is kept and marked unresolved, and raises exactly one
`process-flow-unknown-target` from 1.2.1 naming L4.2. `/api/process` carries
`next` on each child, as codes rather than ids like every other reference in the
API, with an empty list where there are no branches rather than a missing field.
A branch to its own process is dropped; one back to an earlier sibling is kept,
because that is a retry. `--remove` clears packs, processes, the join tables,
the branches and every process finding.

*Org (177, in-process and over HTTP).* `teamId()` fixes case and separators and
deliberately does not merge `Trading Team` into `trading`. A service takes its
own team, a database its owner's, an endpoint its exposer's, a cache its single
writing team's; an external, a contract, an unproduced topic, a two-writer cache
and a topic two teams publish to all have none, and the last of those says why.
An override beats the manifest, carries to everything that inherits from it, and
re-runs the link pass rather than leaving the derived columns stale. With no
registry the teams are still all there, all unregistered, and `unknown-team`
does not fire against the whole organisation. Eight derived handoffs, seven
crossing a team — two of them found only because the consumer named the topic in
`touches`, while the one that names it with no consuming edge derives nothing. A
rolled-up handoff keeps the leaf pair's team rather than the ancestor's. `L2`
hands off to `L3` over two topics, one agreed and one nobody declared. The three
demo defects fire exactly once each. `/api/team`, `/api/teams` and
`/api/handoffs` answer with both ends resolved, `graph?teams=` narrows, and
searching a team's name finds the team and its processes. A registry with two
entries meaning one team, a department nothing declares and an entry with no
usable id reports exactly those three, and one whose alias is also a team entry,
or whose alias two teams both claim, reports those too.

The registry is editable and the editing is checked over HTTP. Renaming a team
the registry never had moves it to the id its name implies, writes it to
`teams.json` with the old spelling as an alias, registers it, and takes the
process it owned with it — while a link written before the rename still
resolves. Renaming onto an existing team is refused with the id it clashed with
and changes nothing; a rename of an entry whose id its author did not derive
from the name keeps the id. Merging folds the team away, keeps both spellings so
a chain of merges loses none, moves the work to the survivor, stops
`unknown-team` firing — and does not rewrite the pack, which still says
`risk-ops`. An override spelt as a merged-away name resolves to the survivor.
Removing the alias un-merges it and the team comes back, unregistered. A key the
editor does not understand — at the top level and on the entry being edited —
survives a write, and a `teams.json` whose `teams` is not a list is refused
rather than replaced.

`/nodes`, `/edges` and `/drift` each narrow to a team, this being the stage
where teams are resolved on more than the one service a manifest names
outright. A connection is kept when *either* end belongs to the team, because a
line that leaves the team is the reason to filter by one — and at least one of
the ones returned does leave it. Most findings now name a team to look at them,
a team that owns none gets none rather than all of them, and a version skew
between two teams is routed to neither.

*Packs (50, in-process).* The situations the demo estate cannot contain, because
its packs are well-formed on purpose. A pack whose `pack` field is not a string
quarantines instead of throwing, and a malformed file in the inbox does not stop
the good file behind it from landing. A typo in `touches` raises
`process-missing-component` **and does not hide the missing interaction beside
it**. Two packs declaring one code raise `process-duplicate-code`, and
re-ingesting the second one keeps the first one's processes — the bug this stage
exists for. An orphan code raises its finding, keeps its own process, invents no
parent and rolls into nothing; no row in `process_components` belongs to a
process that does not exist. A leaf binding nothing raises `process-no-detail`.
Deleting a pack outright has the same hole as re-ingesting one, and does not
take away a code another pack still declares either. The demo estate is
unharmed by all of it.

*The service view (47, no database at all).* The one part of the map that can
be checked without a browser, and the part most worth checking as an estate
grows: whether collapsing an intermediary is still telling the truth. Node
reads `web/src/graph/collapse.ts` and `processDiagrams.ts` directly, so these
assert against the modules the app ships rather than a copy of their rules.

A topic with one publisher collapses into a line per listener, each saying what
carried it. A fan-out stays collapsed however wide, because one publisher means
`p × c` never exceeds `p + c`. A shared bus — five publishers, five listeners —
is *not* expanded into all twenty-five pairs: the topic stays on the map and
the ten edges drawn are the ones the scan actually found. Twelve lines is worth
expanding and thirteen is not, so the threshold cannot drift unnoticed. A
derived line takes the weaker of its two legs and the better of its routes.

And the handoff diagram's rollup collapse: one crossing reported at three
depths draws once and at the depth that happens; two far ends over one topic
draw twice; a leaf crossing is not swallowed by a rollup over the same topic;
a verbatim duplicate draws once rather than never.

**`npm run verify:dev` — 11 checks, one per page, all passing.**

The other two suites drive the production build, which is the right thing to
assert about but is not what anybody runs while working. React only warns
about a render loop in development, and `<StrictMode>` only double-invokes
renders, effects and memo factories there — which is exactly what turns an
unstable `useMemo` dependency from a wasted recomputation into a component
that re-renders until React gives up. A map that did that shipped green
through 452 server assertions and 191 browser checks, because neither of them
runs the build that says so. This one opens every page against `npm run dev`
and fails on any console error.

**`npm run verify:ui` — 220 checks in Chromium at 1280×900, all passing.**

A finding says how long it has been true rather than "just now", names the team
that should look at it, and can be accepted with a reason and reopened again —
the accepted one moving into its own section, carrying the reason on the row,
and coming back when reopened. (`counts.drift` is unchanged and still means
what the link pass found; `counts.driftOpen` is the number that moves when
something is accepted, and the stat tile offers both.)

The map opens collapsed to services and draws all ten of them, with a key
naming the three kinds of line. The number of collapsed lines equals the number
of service pairs derivable from the topology the *other* detail level draws —
counted from what is on screen, so the filter row cannot make the two disagree.
Switching Events off in the key removes those lines and leaves the row there to
switch back on; switching it on restores exactly the previous count. Clicking a
collapsed line names what it runs through. The key itself switches off and back
on. Everything puts the topics and stores back. A node drags, is still where it
was put after a reload, leaves every other node where the layout put it, and
`Reset layout` hands it back — after which the control goes away.

An external survives the collapse as a node of its own, drawn and switched off
as the call it is rather than as a scanned edge.

Isolating is offered only once something is selected. One hop leaves exactly
the node and its neighbours — checked against the graph the map is drawing,
not by eye — two hops reach further, and two hops from a topic reach the
services on the other side of it, which is what the feature was built for. The
way back is on the canvas and taking it puts the map back. Teams draws a
labelled box per team and Columns a counted column per kind, both still drawing
every component the compact layout drew; every service in the Columns
arrangement is centred in the same column to within a pixel. The chord draws an
arc per service and a ribbon per service-to-service line, its key switches a
relation off like the map's does, hovering an arc says how much goes each way,
and clicking one opens it in the inspector.

A level 1 offers all five diagrams; a stage with one team, no handoffs and
nothing below it offers the two it can draw. The flowchart opens on the trigger
and closes on the outcome, draws both conditions of a decision on its arrows,
draws an arm that stops the process as a terminal — once per distinct outcome —
and draws a branch to a code nobody wrote as a dead end that names it. The lane
diagram draws more than one lane and says the lanes are teams. The handoff
diagram draws each process exactly once, including the leaf crossings inside
the process and the topic that carries one.

The services grid puts a service in a team, records it as a correction rather
than a scan, says so on the row, and reverting gives the manifest back. The
editor states the id a rename will produce and the server agrees with it — which
is the check that stops the client's copy of `teamId()` drifting from the
server's. Merging lands on the survivor, keeps both spellings, and removing the
alias un-merges it. A topic is not offered a team to set, because its team is
inherited; it gets a link to where the team came from instead.

Two fresh loads of the map put all ten nodes at byte-identical transforms. A
`kafka.consume` edge's arrow head lands 72px from the service and 275px from the
topic. A plain unforced click on a node fills the inspector. Selecting process
2.1 shows exactly the 8 components `/api/process` reports. The mermaid diagram
for 2.1 draws four steps in code order in both themes. Every new screen —
the tree, a process at each level, a node with processes, the Process map page,
Health, Scan, Search — renders in dark mode with no horizontal scroll and no
console errors. The map on the process page draws exactly the component count `/api/process`
reports, at all three levels. Colouring by team re-tints the nodes and swaps the
legend from kinds to teams, and switching back restores byte-identical colours.
`/teams`, `/team?id=`, a team the registry lacks and the seeded Teams and
handoffs page all render in dark mode with no console errors and no horizontal
scroll. A component that is not in the map renders as unresolved rather
than vanishing — and a missing *interaction* leaves its two real ends as
working links, saying only that the relationship is not in the map. A level 1
offers its diagram and draws four steps, which is the case §8 names. The Scan
page has a drop zone, a file input and a sweep that reports per file, with
relative times in the Repositories table. A service with no citation of its own
does not claim the tool is broken. An empty filtered map points at the filter
row rather than at the seeder.

**By hand.** The inbox round trip: a manifest, a pack and a broken pack swept
together, each routed by shape, the broken one quarantined with its ajv path and
importing nothing. Every new screen looked at in both themes.

**From a clean clone.** `git clone`, `npm install`, `npm run seed:demo`,
`npm run build`, `npm run verify`, `npm start` — on a machine with none of this
repository's `node_modules`, `data/` or `web/dist`. Every §14 number came out
right first time, `npm start` served the built UI and the API on one port, and
`git status` was **clean after the seeder ran**, which is the check that the
generators are deterministic and what is committed under `demo/` is exactly what
they produce.

## Nothing is failing

No verification step is left failing and nothing was weakened to pass. One
thing is *uncovered* rather than failing, and it is named in §"What the scale
pass found": the layout deadline and the worker have no automated check,
because producing a hanging graph in the suite would mean shipping a fixture
big enough to make every run take minutes.

Forty-three defects were found and fixed during the build proper, and a later
pass found more by measuring rather than reading: a map that crashes elk on any
estate with a shared topic, a service-level view that multiplied lines through
one, a filter row that silently did nothing on four screens, a finding table
that could not age or be closed, a version migration reported as a typo, a node
page printing a finding's raw slug, and two of my own — a lost cross-team
crossing and a confidence nothing asserted. Five of the original forty-three
came out of running the thing:

- **`/api/graph` ignored `depth`.** The BFS grew its frontier while iterating the
  edge list, so one pass walked the whole connected component and `depth=1`
  returned 34 nodes instead of 11. §14's "only its direct neighbours" caught it.
- **Double-click on the map did nothing.** d3-zoom's own handler calls
  `stopImmediatePropagation`, so React never saw the event.
- **Clicks near a node could land on an edge.** Lit edges had been raised above
  the node layer, and an edge carries an invisible 20px hit stroke.
- **Process findings linked to `/node?id=proc:3.1.1`**, which is not a node.
  Subjects now route by prefix.
- **An interaction read backwards in flow direction.** `EDGE_LABEL` is written
  from the service's side, so once `flowDirection()` puts the cache first,
  "pricing-quotes — reads cache → order-service" is nonsense. There is a flow
  verb now.

Seven more came out of reading the code against the spec rather than running it,
and none of them was failing — the demo packs are well-formed on purpose and
reach none of these paths. DECISIONS.md has the working for each; the short
version:

- **`npm run verify` deleted the thirteen committed fixtures under `demo/`**
  every time it ran, because it ends by running `seed:demo --remove` and that
  unlinked the files as well as clearing the database. The worst of the seven by
  some distance: a verification run is the last thing that should modify the
  working tree.
- **A typo in `touches` hid a missing interaction** on the same process.
- **Re-ingesting a pack deleted another pack's process** when the two had ever
  shared a code.
- **The process page struck through both ends of a missing interaction**, on a
  screen where both of them are real and one click away.
- **An orphan code seeded phantom parents** in the component join.
- **A pack whose `pack` field was not a string took the whole inbox sweep down**
  as a bind parameter SQLite refuses.
- **A widget was labelled "Process steps"**, which §12.3 says there are none of.

Twenty more came out of an adversarial review — six dimensions read the code
against the spec, and every finding was put to three skeptics told to refute it,
surviving only on a majority. **Eight on the API:**

- **`/api/graph` ignored `repos` entirely**, while §8 documents it, §10 puts a
  Repos multi-select in the filter row, the client sent it on every request and
  `/api/nodes` honoured it — so the same control worked on one page and silently
  did nothing on the map.
- **A repeated query parameter was a 500.** Express parses `?kind=a&kind=b` as
  an array; better-sqlite3 spreads an array into the placeholder list. Both
  filters now mean what they say: two kinds is an `IN`.
- **`PUT /override` could be made to write a row nobody asked for**, with a 200.
  Overrides are the one table §15.4 says must survive a re-ingest.
- **`kind:process` always returned nothing**, on a heading the search page shows.
- **`coverage.covered` was null on a fresh install**, against a contract that
  declares it a number. **`/api/graph` nodes carried no `degree`**, which §8's
  node shape names. **The default `kinds` included contracts**, which §8 makes
  opt-in — a fourth place the spec disagrees with itself, since §14's by-hand
  count of 11 includes one. Both clauses are implemented and both asserted.

**Twelve on the frontend**, the four worst of them:

- **Four screens went stale after a pack arrived.** They key their refresh on
  `lastIngestAt`, which was `MAX(ingested_at)` over manifests only — and a pack
  writes neither. A pack-only sweep left the tree, the ingest log, the process
  picker and the pack list showing the estate as it was before.
- **The node page accused the tool of a bug** — "Nothing should reach this
  state" — on four of the ten demo services, for a situation DECISIONS.md
  records as a gap in the schema and the map inspector words correctly.
- **The Scan page had no Inbox section**, which §10 requires. The sweep button
  threw its per-file results away, so a quarantined document's ajv path — the
  one thing that says what to fix — existed nowhere but the database.
- **A level 1 never offered its diagram**, which is the case §8 names outright
  ("L2 draws four boxes"). The `Note over` branch written for it was
  unreachable, and emitted a participant it had never declared.

The rest: blank bullets on the duplicate-code finding, a count that measured
level instead of provenance, an empty filtered map telling you to re-seed, a
selection that faded the whole canvas once its node was filtered out, two
widgets claiming no packs were loaded when three were, a coverage cell that
counted a component and then showed nothing, a lowest-version marker that sorted
3.10.0 below 3.9.0, and a raw ISO timestamp where §10 asks for relative time.

A second review, of Layer B specifically, found **eleven more**. The two that
matter most were both about determinism and both invisible on the demo data:

- **The rollup kept one exposer per endpoint.** The `to_id → from_id` map
  collapsed on collision, so when two services expose one route — a topology
  Layer A already models and reports as `multiple-owners` — a process kept
  whichever expose edge the scan returned last. Reproduced: it dropped
  `svc:pricing-service` from all three of its rows and raised a false
  `uncovered-component` saying nothing documented touches it, while
  order-and-execution plainly calls it. The answer depended on the order the
  manifests were ingested in, which is exactly what a rebuilt-from-scratch link
  pass is supposed to preclude. Every exposer is kept now, and the verification
  asserts the same answer under both edge orderings.
- **`/api/graph?process=` walked the whole estate and clipped afterwards**, so
  `depth` counted hops through components outside the process — returning nodes
  with no edge touching them, floating unconnected on the overlay. The walk is
  over the process's own edges now.

And **the two demo findings arrived on the Health page as bare slugs.**
`DRIFT_KINDS` had all eight Layer A kinds and none of the six Layer B ones, so
`process-missing-component` and `process-missing-interaction` — the cross-check
§11 calls "the demo of the cross-check that justifies this whole layer" — were
the only findings in the tool with no title and no explanation of what to do
about them. The table is shared between the widget and the process page now.

Also: the process tree threw away whatever the reader had collapsed whenever any
unrelated filter changed; a `$`-bearing pack id was expanded as a `String.replace`
replacement pattern, splicing the whole prompt back into itself; `?root=%`
returned 43 of 46 processes because the value reached a LIKE pattern unvalidated;
`?maxLevel=abc` answered with a silently empty tree; `/api/process` returned
`pack.source` as an unparsed JSON string; an unresolvable widget code rendered a
blank body forever; and `L2.1` typed into a widget came back out as `LL2.1`.

## What importing one repo at a time found

The author imports a service at a time, running the scan prompt against a
different team's repository each time. Doing that, older imports were being
overwritten. Three separate defects, all of them silent:

- **A scan superseded every manifest sharing its `repo` name, not its own
  service.** `upsertTopology` read `WHERE repo = ? AND status = 'active'`, marked
  those superseded, deleted their `edges`, `evidence`, `node_sources`,
  `unresolved` and `contract_bindings`, and then collected any node left with
  nothing pointing at it. Two services scanned out of one repository deleted
  each other. So did two agents that both happened to write the same `repo`
  string — which is what running one prompt across several teams' repositories
  makes likely. The schema has said "one manifest per repository" all along and
  nothing held it to that; `service.id` is required, so the key was already
  there. Now scoped to `repo AND service_id`.
- **A re-scan that found a fraction of what the last one found applied
  silently.** An agent that stops early produces a valid manifest asserting two
  edges where the last one asserted seven, and the difference is deleted with
  no record that it ever existed. Such a scan is now quarantined instead: the
  previous one stays active, a `scan-refused` finding says the map is showing
  the older scan, and the body is kept so the operator can apply it — from
  **Apply anyway** in the ingest log, or `POST /api/ingest?force=true`. The rule
  is half the edges gone and at least three of them, and nothing is judged
  below four edges.
- **`kind` was the one descriptive column any repo could overwrite.** Every
  other field follows the owning repo; `kind` was `kind = excluded.kind`, so
  whichever repo was scanned last decided whether `db:postgres/payments` was a
  database or a cache — its colour, its icon, which filters it appears under and
  which findings could fire for it. Measured, not read: a second repo calling it
  a cache flipped it. It now follows the owner like everything else, and a
  disagreement raises `kind-disagreement` naming both repos, derived from the
  active manifests because the `nodes` table only holds the winner.

**Pure appending was considered and rejected**, and the reasoning is in
DECISIONS.md. A map that can never lose a fact is never wrong about today: a
call deleted from the code would stay on the map for ever. Replacement is
right; the bug was its scope, and a shrinking scan is a question rather than an
instruction.

All three were confirmed against the unfixed code before the fixes went in —
the new checks fail on `main` as it was, with `svc:payments-service` gone
entirely and its seven edges with it.

**If your database already has damage from this**, the manifests are all still
there. This finds the repos that were fighting each other:

```sql
SELECT repo, COUNT(*) AS files, COUNT(DISTINCT service_id) AS services
FROM manifests GROUP BY repo HAVING files > 1 ORDER BY files DESC;
```

Any row with `services > 1` had imports deleting each other. Re-run the scans
for those services, or re-ingest the manifest files if you still have them;
nothing needs to be reset.

## A process code belongs to its pack

The same failure as the scans, one layer up, and worse. The author ran the
authoring prompt against several teams' repositories, a pack at a time. Every
run numbered from 1, because none of them could see the others. `processes.code`
was `UNIQUE` across the whole estate and `id` was `proc:<code>`, so the last
pack ingested took every code the rest had claimed. Hundreds of authored
processes came out as eight rows, and the only symptom was a short tree.

Nothing was lost: every pack's body is in `process_packs.raw`, which is what
made the fix cheap.

**A process is `proc:<pack>:<code>` now, and uniqueness is `(pack, code)`.**
Two teams both starting at 1 are both right, and neither has to know the other
exists. The alternatives — a reserved L1 block per pack, or a pack-declared
prefix — both keep one number line and both need the authors to coordinate,
which is the thing that cannot be made to happen when the prompt is run offline
or in parallel.

What it costs: a code no longer addresses a process. Every link, filter and
reference carries the pack.

- `/api/process` takes `?pack=&code=`. A bare `?code=` is still answered while
  exactly one pack uses that number — people paste codes out of tickets — and
  is a **409 naming the packs** the moment two do, rather than picking one.
- `/api/processes?root=` requires exactly one `pack`: a subtree is a subtree of
  one hierarchy, and mixing two is the original bug in miniature.
- `/api/graph?process=` takes `<pack>#<code>`.
- A reference in `handsOffTo` or `next` is a bare code for this pack and
  `<pack>#<code>` for somebody else's. A bare code deliberately cannot reach
  outside its pack; it would otherwise resolve to this pack's own process of
  the same number, silently.
- `process-duplicate-code` now means **one pack** declaring a code twice, which
  still loses a process. Two packs doing so is no longer anything.

**On the first boot after this, `processes` is dropped and replayed** from the
active packs — its primary key and its uniqueness both changed, and ALTER TABLE
can do neither. `server/src/index.js` prints a line saying how many packs it
replayed into how many processes. `first_seen` is carried across by code, so a
process that really was in the table keeps the day it was first documented; one
that was being overwritten was never there to have one. Accepted findings on
processes are keyed by a fingerprint that includes the subject id, so those need
accepting again — the one thing the migration does not preserve.

### A pack now says what it covers

`covers` is a new optional block: the `team` that owns the document, and the
`services` whose work it describes. It does three things.

It says what the pack is for without opening it. It **scopes the authoring
prompt** — the components list was the whole estate, which is most of the
prompt's length, and every component in it the team does not run is a chance to
bind a process to the wrong service. And it makes `process-outside-covers`
derivable: a process whose `node` is outside the boundary.

`node` only — where the work happens. An `interaction` leaving the boundary is a
handoff and the most valuable thing in a pack; reporting those would report
every crossing in the estate and bury the one case worth a line.

### The prompt changed, and this is the part to re-read

`prompts/author-processes.md` is at `promptVersion: 2026-09-24a`:

- **Number from 1.** The numbering is the pack's own; another team's is not
  yours to work around. This is the instruction that was wrong before.
- The codes it lists are **this pack's**, not the estate's, so re-authoring a
  pack keeps the numbers people are citing.
- The components it lists are **the boundary's**, with a line saying what it was
  narrowed to and how much of the estate that is.
- It asks for `covers`, and says which of `node` and `interaction` should stay
  inside it.
- A cross-pack handoff is written `<pack>#<code>`.

On the Scan page's *Processes* tab there is now a team selector beside the pack
box, for a pack's first run, when there is no stored `covers` to narrow by.

### What was checked

**There is a seventh verification stage, `migrate`, and it is the important
one.** It builds a database in the old shape by hand — the `processes` table
with no `pack` column and `code` unique estate-wide — loads three packs each
numbering from 1, and asserts that the old scheme kept **five of the twelve
they declare and deleted one pack entirely**. That is the author's bug,
reproduced. It then opens the same file with the current code and asserts the
migration replays all twelve, four to a pack, one code now three processes.

It was written by reproducing the failure first, against the previous commit
in a throwaway worktree: three packs, twelve processes, five rows. The stage
builds the old shape with raw SQL rather than depending on that commit still
being reachable.

**That stage caught a defect in the migration.** `first_seen` was carried by
code alone, which handed every pack's `2` the date belonging to whichever
pack's `2` had won the row — a documented-since date for a process that had
never been in the table. It is carried by `(pack, code)` now, so only the row
that really was there keeps its date.

`/api/graph?process=` takes the same `<pack>#<code>` reference, and a bare code
that two packs use draws nothing and says which packs it could have meant,
rather than answering with whichever sorted first.

The rest of the regression tests are in the `packs` stage: two packs each
declaring `8.2`, both keeping everything they declared, neither raising a
finding. Beside it: a pack declaring one code twice still loses a process and
still raises `process-duplicate-code`; deleting a pack takes only its own rows;
`<pack>#<code>` resolves into the other pack while a bare code stays home even
when another pack has that number; a `covers` probe where one process names
another team's service and another merely reaches into one, with only the first
reported.

### Known gaps

- **The demo estate's three packs still take an L1 each** (1, 2, 3), because
  that is what they were authored as. They no longer have to, and a new pack
  should not try to.
- **`process-outside-covers` is info, and fires on nothing in the demo** — the
  demo packs' `covers` lists every service whose work they claim. The probe in
  the `packs` stage is what proves it fires at all.
- **`covers.repos` is accepted, stored and displayed, and nothing derives
  anything from it.** It is there because a pack authored by reading code
  should be able to say which code; joining it to the manifests is not done.

## What the scale pass found

The demo estate is ten services, sparse, with no node anything else crowds
around. Everything below was measured against a synthetic estate shaped like a
real one instead: every service owning a database and a topic, plus the two
things a demo estate never has — a shared audit topic many services publish and
many consume, and a shared database many write and many read.

**The service-level collapse multiplied through them.** Collapsing an
intermediary asserts one line per producer per consumer:

| services | Everything | Services level |
|---|---|---|
| 30 | 92 nodes / 205 lines | 30 nodes / **740** lines |
| 60 | 182 / 370 | 60 / **2,100** |
| 120 | 362 / 700 | 120 / **7,500** |

The level meant to reduce clutter produced 3.6× more lines than showing
everything. One audit topic with 30 producers and 15 consumers is 450 lines on
its own, none of which the scan found.

**elk did not slow down so much as stop.** Timings are node, main thread, with
the `compact` options exactly as shipped:

| | graph | result |
|---|---|---|
| no hub | 92 nodes / 150 lines | 3,971 ms |
| no hub | 182 / 300 | 35,113 ms |
| hub | 92 / 205 | no result in 45 s |
| hub | 182 / 370 | **RangeError: Maximum call stack size exceeded**, 1.9 s |
| hub | 362 / 700 | **RangeError**, 5.5 s |
| hub, services | 30 / 740 | **RangeError**, 3.5 s |
| hub, services | 60 / 2,100 | **RangeError**, 16.9 s |

A control rules out cycles: the same estate as a DAG behaves identically. It is
a single high-degree node that tips it. Deduplicating parallel edges — the
obvious fix — does not save it either: 740 lines deduped to 600 still threw.

In Chromium the 182-node graph did not finish within 100 s rather than throwing,
browsers having a deeper stack. That is worse, not better: a frozen tab with no
error. It is also why the fix is a deadline and a worker rather than only a
`.catch`.

**Three cost figures do not line up with size at all**: 62 nodes 1.5 s, 92 nodes
3.6 s, 122 nodes 15.9 s, 152 nodes 12.2 s. Layout cost follows a graph's shape.
Any guard phrased as a node count would refuse healthy graphs and admit hanging
ones, which is why the guard is a clock.

### What is fixed

- A middle node whose expansion would assert more than the scan found stays on
  the map and is drawn with its own scanned edges: `p + c`, not `p × c`.
- elk runs in a worker against a 10-second deadline; a worker that blows it is
  terminated and the map says so, offering Columns, which uses no engine.
- `layoutGraph` finally has a `.catch`. Without it a failure left the spinner
  running for ever and a crash was indistinguishable from a slow graph.
- elk is no longer handed duplicate edges it cannot use — only node positions
  are ever read back from it.

### What is not covered by a check

The deadline and the worker are **not** exercised by either suite. There is no
way to produce a hanging graph in the suite without shipping a large fixture,
and a fixture big enough to hang elk would make every run take minutes. The
collapse rule *is* covered, by 18 checks in the `map` stage that import the
app's own module. The numbers above are reproducible by hand; the probe is not
committed, being a throwaway.

## Things worth knowing before you touch it

- **The demo data is the test suite.** `server/scripts/demo/estate.mjs` is the
  estate, `packs.mjs` the processes. Changing either changes what `npm run
  verify` asserts, and §14 and §10's numbers come from SPEC §12 and
  SPEC-PROCESSES §11 — read both before editing. Both generators are
  deterministic, so re-running the seeder produces byte-identical files.
- **`packs.mjs` keeps structure and prose apart on purpose.** The structure is
  what the verification asserts; the prose is what the screens are designed
  against. Editing one should not risk the other.
- **The map's default view is the collapsed one, and the collapse is derived
  per render in `web/src/graph/collapse.ts`.** Nothing it produces is stored, and
  nothing stored depends on it: counts, search and drift all read the scanned
  edges. If you add an edge kind, add it to `OUT`/`IN` there or it will simply
  not appear at service level — silently, because a kind that collapses to
  nothing is indistinguishable from one nobody uses.
- **elk's layers wrap past an aspect ratio of 1.7.** An estate is mostly one
  long dependency chain, so a single run of layers gives a ribbon — 1968×214 at
  service level on the demo estate, which `fitView` renders as a row of specks.
  Wrapping folds it to 1226×715 for the same input. Still deterministic, and a
  graph that is already squarer comes out unchanged, so the option is a no-op
  for a focused view or a small process.
- **A hand-placed node wins over the layout, for as long as it is saved.** The
  arrangement lives in `localStorage` under
  `architecture-map.layout.<map>.<detail>` and the layout engine places only
  what is not in it. Two consequences: a saved arrangement survives a re-scan
  that adds nodes (the new ones are laid out around it), and a map whose
  arrangement was saved before a big ingest can look stale until somebody hits
  `Reset layout`. Nothing warns about that yet.
- **Four findings are implemented but produce nothing on the demo data** —
  `near-miss`, `no-consumer`, `orphan-endpoint` and `multiple-owners`, because
  the estate does not contain those situations. The cheapest way to check one is
  to hand-edit a file into `inbox/` and sweep. The three process findings that
  used to be in this list — `process-orphan-code`, `process-duplicate-code` and
  `process-no-detail` — now have synthetic packs in the `packs` verification
  stage, which is where four of the seven polish defects were caught. **That
  asymmetry is the lesson of this build: every defect found by reading rather
  than running lived on a path the demo data does not reach.** The four Layer A
  findings above are the remaining ones, and they are where to look next. The
  three newest kinds — `scan-refused`, `kind-disagreement` and
  `process-outside-covers` — produce nothing on the demo data either, and are
  deliberately not in that list: each is asserted against a document built for
  it (the first two in the `ingest` stage, the third against a probe pack in
  `packs`), and `scan-refused` is driven through the ingest log's **Apply
  anyway** button at the end of the browser suite.
- **A group box is a React Flow node.** Two arrangements draw them, so every
  check that counts "things on the map" goes through `MAP_NODE` in
  `verify-ui.mjs`, which excludes them. If you add a count, use it.
- **Isolation is applied last, over what the key left**, and the walk is
  undirected. Both are deliberate: two hops through things you switched off
  would be two hops through a graph nobody is looking at, and "what does this
  topic connect to" means its producers as well as its consumers.
- **`Fewest crossings` is not the slow one.** Thoroughness is a search budget
  so it ought to be, and is not: the wrapping `compact` does costs more than
  the search. 341ms against compact's 633ms on the demo estate, holding at
  about half the way up to 258 nodes. What it costs is height.
- **The key floats over the canvas and it is a controls panel now**, so a drag
  that starts under it is a click on the key — which is why `verify:ui` shuts
  it before dragging, and why it can be shut at all. Both panels are width
  capped for the same reason: uncapped, the key reached across a narrow card
  and sat on top of whatever the map was saying in the other corner.
- **The Services view is services, and what it cannot collapse is counted on
  them.** An endpoint called but not exposed, a topic nobody produces, a bus
  half the estate shares: none of them can become a line, and none of them
  goes on the map either. The service that reaches for it carries a count in
  its kind row and a list in the inspector. A thing only one service touches,
  like its own database, is simply collapsed away as it always was — nothing
  is missing from it, so there is nothing to carry.
- **Map nodes have a handle on all four sides, and MapCanvas picks the pair.**
  If you add a node kind, it gets them from `Shell` and needs nothing. If you
  add an edge, `sideFacing` decides where it lands — and it is measured
  against each box's own proportions, so do not simplify it to `dx` versus
  `dy`. The choice follows a drag, because it is computed from the nodes React
  Flow is rendering rather than from the layout that placed them.
- **The chord is directional, and it spends shape on it rather than colour.**
  A ribbon's colour is the relationship — event, call, shared store — and the
  key reads off that, so direction is the arc split (solid sends, pale
  receives) plus an arrowhead at the end each ribbon arrives at. The split was
  free: the layout already allocated every arc's outgoing slices before its
  incoming ones, so the angle was there to be drawn.
- **The chord's geometry is in `web/src/graph/chordLayout.ts`, written rather
  than imported.** It is pure and deterministic; `Chord.tsx` is only the
  drawing. An arc is sized by out *and* in together, which is where it departs
  from d3's default and the reason a service everybody calls still gets an arc.
  It is *not* called `chord.ts`, and must not be: a resolver on a
  case-insensitive filesystem tries `.ts` before `.tsx`, so `./Chord` answered
  with `chord.ts` and the app rendered a blank screen on every Mac while
  building and verifying cleanly on Linux. The `map` stage now fails on any two
  modules under `web/src`, `server/src` or `server/scripts` whose names differ
  only in case — it is the one class of defect this repository's own machine
  cannot reproduce.
- **`next` is the departures from the numbering, not the sequence.** A process
  with no `next` falls through to the next sibling exactly as it always did, so
  every pack written before this draws the same straight line. If you add a
  field to it, the rule to hold onto is that a `next` restating the numbering is
  noise the first renumbering will break.
- **A branch is read off `process_packs.raw` by the link pass**, like `touches`
  and `handsOffTo`, and resolved into `process_next` which is rebuilt whole. A
  target nobody has written is kept with `resolved = 0` and reported. A branch
  to the process it leaves is dropped; one back to an earlier sibling is kept,
  because that is a retry.
- **A diagram tab is offered only when it has something to draw.** The rule
  lives in `available()` in `web/src/graph/processDiagrams.ts` and it shares
  `laneSplit()` with the lane generator on purpose — the two answering
  differently is how you get a tab that renders one lane.
- **A green `verify` and `verify:ui` do not mean the dev server is clean.**
  Both drive the production build. React's render-loop warning and
  StrictMode's double-invocation are development-only, so a component that
  re-renders itself for ever is invisible to them — that is exactly how one
  shipped. `npm run verify:dev` is the one that catches it, and it is worth
  running before saying a UI change is done.
- **`verify:ui` serves `web/dist`, not your source.** It is the production
  build it drives, so a change to `web/src` that has not been rebuilt is
  silently not under test — the suite runs green against the previous bundle
  and tells you nothing is wrong. `npm run build && npm run verify:ui`, always,
  in that order. (`npm run verify` needs no build: it imports the source.)
- **Running the two suites at the same time will fail checks.** They share
  `data/`, and one truncating the other's tables mid-run produces failures
  that look like real defects and do not reproduce. Likewise
  `node server/scripts/verify.mjs --stage=<x>` on its own runs against your
  *working* database rather than a throwaway one, because `DATA_DIR` is set by
  the orchestrator — it will ingest the fixtures into your estate. Use
  `npm run verify` unless you know you want that.
- **Render the RESOLVED team, never `node.team`.** `team` is the string the
  scan found in a manifest; `teamId`/`teamName` are what the registry resolves
  it to, and they are what the map colours by, what the filters join on and
  what a merge, a rename or a hand-assignment move. Three screens printed the
  raw one — the services list, the map inspector and the process page's team
  count — so a merged team kept its old name and two spellings of one team
  counted as two. The merge check that existed could not catch it, because it
  merges `risk-ops`, which is a *process* owner and belongs to no service; the
  one that does now merges Wallet into Trading on purpose.
- **The registry is now something the server writes.** Both verification
  suites run against a *copy* of `demo/teams.json` under `data/` for that
  reason: `verify:ui` renames and merges teams, and pointed at the repo root it
  would edit whatever real org chart is on the machine. If you add a check that
  touches teams, check what `TEAMS_FILE` is pointing at first.
- **A merged team is an alias and nothing else.** No manifest is rewritten and
  no row is deleted, so every merge is reversible by removing the alias. The
  corollary is that a spelling the data still uses comes back the moment the
  alias goes, which is the behaviour you want and a surprise the first time.
- **`teamId()` is stated twice** — `server/src/teams.js` and
  `web/src/lib/teams.ts` — so the editor can say what an id will become before
  the request is sent. The browser check "the server agrees with it" is what
  holds them together; if you change one, that check is what fails.
- **`stale-evidence` is not produced**, per SPEC §6 — it is reserved, and nothing
  re-reads the cited lines.
- **`prompts/scan-pass2-link.md` renders with `{{MANIFESTS}}` still in it.**
  `/api/prompt` substitutes `{{SCHEMA}}`, `{{REPO}}`, `{{PACK}}`, `{{COMPONENTS}}`
  and `{{PROCESSES}}`, and nothing fills `{{MANIFESTS}}`. Nothing reaches it —
  the Scan page offers only `scan-pass1` and `author-processes`, and pass 2 is
  the next thing on the list below — but if you wire pass 2 up, that placeholder
  is the first thing to fill in.
- **A pack ingested before any manifest resolves nothing**, and that is correct:
  the link pass re-resolves after every ingest of either kind, so the manifest
  landing later fixes it. The seeder loads manifests first as a courtesy, not a
  requirement.
- **`processes.code` is unique across packs.** Two packs declaring one code
  leaves the row holding the last writer and raises `process-duplicate-code`,
  which is read off the packs rather than the rows. It is a finding, not an
  error, so the ingest does not fail.

## What I would do next, in order

1. **Route a finding to more than one team.** `drift.team_id` is a single
   column, so a version skew between two teams and a topic two teams publish
   stay unrouted — 5 of the demo estate's 15. That is honest (more than one
   team *is* the finding) but it means the two most interesting kinds never
   reach an inbox. A join table would fix it; the question is whether the
   finding should then be resolvable by naming an owner, which is item 6 below
   and probably the same piece of work.
2. **Stale evidence.** Given a checkout, re-read each cited `file:line` and
   compare it to the stored snippet. The schema already promises this ("ingest
   re-checks it, and a snippet that no longer matches marks the fact stale") and
   `drift.stale-evidence` is reserved for it. It is what turns the map from "true
   when it was scanned" into "provably still true", and it is the last piece of
   the honesty argument that is missing.
3. **Pass 2.** `prompts/scan-pass2-link.md` exists and nothing runs it. The
   `near-miss` findings are exactly its input, and reconciling ids across
   manifests is what stops a ten-repo estate becoming ten islands.
4. **Edge overrides and `hidden`.** `overrides` supports `subject_kind='edge'`
   and a `hidden` field, `/api/graph` already honours `hidden` on nodes, and no
   screen writes either. A "this edge is wrong" button is a small change with a
   large effect on whether people trust the map enough to correct it.
5. **Process coverage as a first-class report.** `/api/coverage` and the
   `process-coverage` widget exist; what is missing is the other direction —
   which processes have gone longest without anybody confirming them. `source.asOf`
   is already stored and the process page already shows its age.
6. **Team assignment should reach further than a service.** Only a service can
   be put in a team today, because everything else inherits. The cases that
   would want their own are a topic two teams publish (deliberately teamless,
   and `multi-team-topic` says why) and a cache two teams write. Both are real
   findings rather than gaps, so the right move is probably to let the *finding*
   be resolved by naming an owner, not to add a free-floating override.
7. **A saved map arrangement should be shareable.** It is per browser today.
   The obvious shape is a `layout` field on the widget's options, saved with the
   page like everything else on it, with `localStorage` as the per-person
   override. That is also what would let a team agree on one picture of the
   estate rather than each drawing their own.
