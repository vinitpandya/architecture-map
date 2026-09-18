# Handover

Written at the end of a single session that took the repository from "the shell
works, nothing under it does" to all six phases of SPEC.md §13 complete and
verified. Read [DECISIONS.md](DECISIONS.md) alongside this — it has the working
for every judgement call, including two places where the spec contradicts
itself.

## Run it

```bash
npm install
npm run seed:demo     # the Meridian estate: ten services, 43 nodes, 92 edges
npm run dev           # UI http://localhost:5173 · API http://localhost:8787
```

```bash
npm run verify                 # SPEC.md §14 as a runnable check — 53 assertions
npm run seed:demo -- --remove  # clear the demo estate again
npm run validate -- inbox/x.json
npm run build && npm start     # production build, UI and API on one port
```

## Phases

| Phase | State |
|---|---|
| 1 · topology upsert | Complete, verified |
| 2 · link pass and drift | Complete, verified |
| 3 · demo estate | Complete, verified |
| 4 · search index | Complete, verified |
| 5 · the map | Complete, verified in a browser |
| 6 · finish | Complete — `reference/` deleted, README rewritten, clean-clone test run |

Two things beyond §13, both §10 requirements the shell had not met: node detail
now renders per kind (producers/consumers for a topic, owner/writers/readers for
a store, bindings sorted by version for a contract) with an inline description
edit that writes an override, and the drift widget groups findings by kind and
expands to the participating services and the code that proves each one.

## What was actually run

`npm run verify` — 53 assertions across two stages, both passing. It runs
against throwaway databases under `data/verify/`, so it is safe at any time.

**Phase 1** (17 checks, in-process against a fresh database)
- `validate.mjs` exits 0 on `schema/example.payments-service.json`, exits 1 on
  the same file with a `kind` typo, and names `/edges/0/kind`.
- A quarantined manifest leaves exactly one `manifests` row and zero rows in
  `nodes`, `edges` and `evidence`.
- Ingesting the example twice leaves one active manifest and one superseded, and
  does not double nodes, edges, evidence or bindings.
- Re-ingesting the same manifest with its edges and evidence reordered leaves
  every `edges.id` unchanged, and `first_seen` with them.
- The contract version is in `contract_bindings`, not on the `nodes` row.

**Phases 2–4** (36 checks, over HTTP against the seeded estate)
- Counts: services 10, topics 9, contracts 5, endpoints 6, databases 8, caches
  2, externals 3, quarantined 0, unresolved 3. All match §14.
- Drift: exactly one `no-producer` (`topic:risk.flagged.v1`), exactly one
  `shared-database` (`db:postgres/ledger`), three `version-skew` including
  `OrderMatched` (3.2.0 vs 2.8.1) and `UserCreated` (3.2.0 vs 3.0.0), zero
  `multiple-owners`.
- `/api/node?id=topic:users.created.v2` → 1 producer, 3 consumers.
- `/api/graph?focus=svc:order-service&depth=1` → 11 nodes, every one adjacent to
  order-service. The 11 is counted by hand off §12: three topics, one database,
  one cache, four endpoints, one contract, plus itself.
- Search: `KafkaListener`, `@KafkaListener`, `GET /v1/rates/{}`,
  `payments.settled.v1` and `posting` all return 200 with hits — the last one
  proving a table name inside a SQL snippet is findable. `kind:topic orders`
  returns only topics.
- **The override test.** Setting a `description` override changes `/api/node`,
  and re-ingesting that repo does not revert it.

**Phase 5** (in Chromium at 1280×900, against the production build)
- Two completely fresh page loads put all 35 nodes at byte-identical transforms.
- A `kafka.consume` edge, stored service → topic, renders with its arrow head
  72px from the service and 275px from the topic.
- Every node kind is legible in dark mode on `/` and on `/node`; checked with
  all seven kinds on screen, not just the five the default filter shows.
- No horizontal page scroll at 1280px on the map, on `/node` for all seven
  kinds, or on any of the five seeded pages at 1440px.
- Single click fills the inspector with citations; double click re-focuses and
  writes `?focus=&depth=` so the back button undoes it.

**Phase 6**
- `data/` and `node_modules/` deleted, then `npm install && npm run seed:demo &&
  npm run build && npm start`: the built UI and the API both serve on 8787, and
  the full verification and browser checks pass against that build.
- The inbox round trip by hand: a valid manifest and a broken one swept
  together; the valid one re-ingested without changing any count, the broken one
  quarantined with `/edges/0/kind` and filed into `inbox/quarantine/`, importing
  nothing. The repo it would have replaced kept its active manifest.

## Nothing is failing

No verification step is left failing and nothing was weakened to pass. Two
defects were found and fixed rather than worked around:

- **`/api/graph` ignored `depth`.** The BFS added to its frontier while
  iterating the edge list, so a single pass walked the whole connected component
  and `depth=1` returned 34 nodes instead of 11. §14's "only its direct
  neighbours" check is what caught it. Each hop now collects into its own set,
  and `depth=0` means the whole component as §8 says.
- **Double-click on the map did nothing.** d3-zoom's own double-click handler
  calls `stopImmediatePropagation` on the pane, so React never saw the event.
  `zoomOnDoubleClick` is now off, which is right anyway — double click means
  re-focus here.

## Things worth knowing before you touch it

- **The whole-estate map is dense and small.** 35 nodes laid out left-to-right
  is a wide, short graph, so `fitView` zooms out and leaves vertical space above
  and below. It is correct and deterministic, but the readable views are a
  focused one (double-click a node, or pick a focus) or full screen. If you want
  a better default, a `minZoom` on `fitView` is the place to start — accepting
  that it means the estate no longer fits on screen at once.
- **The estate is the test suite.** `server/scripts/demo/estate.mjs` is the
  Meridian estate as data and `manifests.mjs` turns it into per-language
  manifests. Changing either changes what `npm run verify` asserts, and §14's
  numbers come from SPEC §12, so read both before editing.
- **The seeder is deterministic.** Line numbers and commit shas are hashed from
  their inputs, so re-running it produces byte-identical files and no git churn.
  If you add a relationship, re-run `npm run seed:demo` and commit the manifests
  it writes.
- **`near-miss`, `no-consumer`, `orphan-endpoint` and `multiple-owners` are
  implemented but produce nothing on the demo estate**, because the estate does
  not contain those situations. They are exercised only by construction, not by
  the verification run. If you change the link pass, the cheapest way to check
  them is to hand-edit a manifest into `inbox/` and sweep.
- **`stale-evidence` is not produced**, per §6 — it is reserved, and nothing
  re-reads the cited lines. Re-checking a snippet against a real checkout is the
  obvious next feature and the schema already says ingest will do it.
- **Layer B is tables only.** `processes` and `process_steps` exist, nothing
  reads or writes them, and that is deliberate per §1.

## What I would do next, in order

1. **Pass 2.** `prompts/scan-pass2-link.md` exists and nothing runs it. The
   `near-miss` findings are exactly the input it wants, and reconciling ids
   across manifests is the thing that stops a ten-repo estate becoming ten
   islands.
2. **Stale evidence.** Given a checkout, re-read each cited `file:line` and
   compare it to the stored snippet. The schema already promises this ("ingest
   re-checks it, and a snippet that no longer matches marks the fact stale") and
   `drift.stale-evidence` is reserved for it. It is what turns the map from
   "true when it was scanned" into "provably still true".
3. **Edge overrides and `hidden`.** `overrides` supports `subject_kind='edge'`
   and a `hidden` field, `/api/graph` already honours `hidden` on nodes, and no
   screen writes either. A "this edge is wrong" button is a small change with a
   large effect on whether people trust the map enough to correct it.
4. **A better default map view.** See the density note above.
5. **Layer B**, once there is something worth hanging processes off.
