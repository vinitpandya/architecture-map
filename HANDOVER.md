# Handover

Two sessions. The first took the repository from "the shell works, nothing under
it does" to Layer A complete — SPEC.md phases 1–6. The second added Layer B, the
business processes — SPEC-PROCESSES.md phases 7–11. Both are complete and
verified.

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
npm run verify                       # SPEC.md §14 and SPEC-PROCESSES.md §10 — 103 assertions
npm run build && npm run verify:ui   # the checks that need a browser — 45 more
npm run seed:demo -- --remove        # clear the demo estate and its packs
npm run validate -- <file>           # routes by shape: manifest or process pack
npm run build && npm start           # production build, UI and API on one port
```

Both verify scripts run against throwaway databases under `data/`. Neither
touches your own.

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

Beyond §13 and §9's lists, two things the shells had not met: node detail renders
per kind (the topic page — producers against consumers with the version skew
flagged — is the good one), and drift is grouped findings that expand to the
participating parties and the code that proves each, rather than a table.

## What was actually run

**`npm run verify` — 103 assertions across three stages, all passing.**

*Ingest (17, in-process against a fresh database).* `validate.mjs` exits 0 on the
example and 1 on a `kind` typo naming `/edges/0/kind`. A quarantined manifest
leaves one row and zero nodes, edges and evidence. Re-ingesting leaves one active
manifest, doubles nothing, and leaves every `edges.id` and `first_seen`
unchanged when the manifest's edges and evidence are reordered. The contract
version is in `contract_bindings`, not on the node.

*The estate (36, over HTTP).* Every §14 count — 10 services, 9 topics, 5
contracts, 6 endpoints, 8 databases, 2 caches, 3 externals, 0 quarantined, 3
unresolved. Exactly one `no-producer` (`topic:risk.flagged.v1`), exactly one
`shared-database` (`db:postgres/ledger`), three `version-skew` including
`OrderMatched` at 3.2.0 vs 2.8.1 and `UserCreated` at 3.2.0 vs 3.0.0, zero
`multiple-owners`. `/api/graph?focus=svc:order-service&depth=1` returns 11 nodes,
all adjacent. Five searches including `@KafkaListener` and `GET /v1/rates/{}`
return hits rather than an FTS5 syntax error. **An override changes
`/api/node` and a re-ingest of that repo does not revert it** — the single most
important test in the suite.

*Processes (50, over HTTP).* `validate.mjs` says which schema it picked. A
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
`2.3.3`, `L2.3.3` and `orders.matched.v1` all work. `--remove` clears packs,
processes, the join tables and every process finding.

**`npm run verify:ui` — 45 checks in Chromium at 1280×900, all passing.**

Two fresh loads of the map put all 35 nodes at byte-identical transforms. A
`kafka.consume` edge's arrow head lands 72px from the service and 275px from the
topic. A plain unforced click on a node fills the inspector. Selecting process
2.1 shows exactly the 8 components `/api/process` reports. The mermaid diagram
for 2.1 draws four steps in code order in both themes. Every new screen —
the tree, a process at each level, a node with processes, the Process map page,
Health, Scan, Search — renders in dark mode with no horizontal scroll and no
console errors. A component that is not in the map renders as unresolved rather
than vanishing.

**By hand.** The inbox round trip: a manifest, a pack and a broken pack swept
together, each routed by shape, the broken one quarantined with its ajv path and
importing nothing. Every new screen looked at in both themes.

## Nothing is failing

No verification step is left failing and nothing was weakened to pass. Five
defects were found and fixed rather than worked around:

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
  the estate does not contain those situations, plus `process-orphan-code`,
  `process-duplicate-code` and `process-no-detail` for the same reason on the
  packs. They are exercised by construction, not by the verification run. The
  cheapest way to check one is to hand-edit a file into `inbox/` and sweep.
- **`stale-evidence` is not produced**, per SPEC §6 — it is reserved, and nothing
  re-reads the cited lines.
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
