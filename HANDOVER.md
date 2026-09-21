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

Between B and C a polish pass read the whole result back against the spec and
found defects on paths the demo data never reaches. That turned out to be the
most productive thing in the build, and it is why §"Nothing is failing" below is
as long as it is.

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
npm run verify                       # §14, SPEC-PROCESSES §10 and SPEC-ORG §10 — 318 assertions
npm run build && npm run verify:ui   # the checks that need a browser — 93 more
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

Beyond §13 and §9's lists, two things the shells had not met: node detail renders
per kind (the topic page — producers against consumers with the version skew
flagged — is the good one), and drift is grouped findings that expand to the
participating parties and the code that proves each, rather than a table.

## What was actually run

**`npm run verify` — 318 assertions across five stages, all passing.**

*Ingest (26, in-process against a fresh database).* `prompts/standalone/` is in
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

*The estate (49, over HTTP).* Every §14 count — 10 services, 9 topics, 5
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

*Processes (74, over HTTP).* `validate.mjs` says which schema it picked. A
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
already taken. `--remove` clears packs,
processes, the join tables and every process finding.

*Org (119, in-process and over HTTP).* `teamId()` fixes case and separators and
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
usable id reports exactly those three.

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

**`npm run verify:ui` — 93 checks in Chromium at 1280×900, all passing.**

Two fresh loads of the map put all 35 nodes at byte-identical transforms. A
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

No verification step is left failing and nothing was weakened to pass.
Forty-three defects were found and fixed rather than worked around. Five came
out of running the thing:

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

## Things worth knowing before you touch it

- **The demo data is the test suite.** `server/scripts/demo/estate.mjs` is the
  estate, `packs.mjs` the processes. Changing either changes what `npm run
  verify` asserts, and §14 and §10's numbers come from SPEC §12 and
  SPEC-PROCESSES §11 — read both before editing. Both generators are
  deterministic, so re-running the seeder produces byte-identical files.
- **`packs.mjs` keeps structure and prose apart on purpose.** The structure is
  what the verification asserts; the prose is what the screens are designed
  against. Editing one should not risk the other.
- **The whole-estate map is dense and small.** 35 nodes laid out left to right is
  a wide, short graph, so `fitView` zooms out and leaves vertical space. It is
  correct and deterministic; the readable views are a focused one, a process, or
  full screen. A `minZoom` on `fitView` is where to start if you want a better
  default, accepting that the estate then no longer fits on one screen.
- **Four findings are implemented but produce nothing on the demo data** —
  `near-miss`, `no-consumer`, `orphan-endpoint` and `multiple-owners`, because
  the estate does not contain those situations. The cheapest way to check one is
  to hand-edit a file into `inbox/` and sweep. The three process findings that
  used to be in this list — `process-orphan-code`, `process-duplicate-code` and
  `process-no-detail` — now have synthetic packs in the `packs` verification
  stage, which is where four of the seven polish defects were caught. **That
  asymmetry is the lesson of this build: every defect found by reading rather
  than running lived on a path the demo data does not reach.** The four Layer A
  findings above are the remaining ones, and they are where to look next.
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

1. **Stale evidence.** Given a checkout, re-read each cited `file:line` and
   compare it to the stored snippet. The schema already promises this ("ingest
   re-checks it, and a snippet that no longer matches marks the fact stale") and
   `drift.stale-evidence` is reserved for it. It is what turns the map from "true
   when it was scanned" into "provably still true", and it is the last piece of
   the honesty argument that is missing.
2. **Pass 2.** `prompts/scan-pass2-link.md` exists and nothing runs it. The
   `near-miss` findings are exactly its input, and reconciling ids across
   manifests is what stops a ten-repo estate becoming ten islands.
3. **Edge overrides and `hidden`.** `overrides` supports `subject_kind='edge'`
   and a `hidden` field, `/api/graph` already honours `hidden` on nodes, and no
   screen writes either. A "this edge is wrong" button is a small change with a
   large effect on whether people trust the map enough to correct it.
4. **Process coverage as a first-class report.** `/api/coverage` and the
   `process-coverage` widget exist; what is missing is the other direction —
   which processes have gone longest without anybody confirming them. `source.asOf`
   is already stored and the process page already shows its age.
5. **A better default map view.** See the density note above.
