# Decisions

Judgement calls made while building SPEC.md §13 (Layer A, phases 1–6) and
SPEC-PROCESSES.md §9 (Layer B, phases 7–11), with the reason for each.
Where the spec was silent I chose the option most consistent with the
surrounding design; where the spec contradicted itself I have said so and shown
the working.

## Where the spec disagrees with itself

**`shared-database` counts writers, and the demo gives reporting-service a
write on the ledger.** §6 defines the finding as "a database written or owned
by >1 distinct service". §12 says `svc:reporting-service` has a `db.read` on
`db:postgres/ledger` and calls that pair "a deliberate shared-database
finding", but a read alone cannot produce that finding under §6 — and if the
rule were widened to any access, `db:elasticsearch/search` (owned by reporting,
read by gateway) would fire too, breaking §14's "exactly one". So §6 stands as
written and the demo estate gives reporting-service the write §12's annotation
implies: an export checkpoint table kept inside the ledger schema, alongside the
read §12 asks for. §12 says every listed relationship must appear, not that
nothing else may.

**`multiple-owners` fires only for `db.owns` and `http.expose`.** §6 derives
ownership from those two plus `kafka.produce`, and says several claims raise the
finding — but §12's `topic:notifications.requested.v1` is produced by both
order and payments, and §14 expects zero `multiple-owners`. Ordinary fan-in onto
a topic is not a defect and flagging it would train people to ignore the
finding, so `kafka.produce` still decides a topic's `owner_repo` (first claim by
`first_seen`, repo breaking the tie) without raising a finding when several
services produce.

## Ingest

- **A node's descriptive fields follow its owning repo.** A repo that merely
  references someone else's node can fill a field that is empty but never
  overwrite one the owner set; with no owner, the most recent writer wins. Any
  other rule makes a node's description depend on ingest order.
- **`service.tags` is accepted but not stored.** The schema allows it, §4 has no
  column for it, and inventing one is a schema change nothing reads.
- **A service node has no evidence of its own.** The schema's `service` block
  carries no `evidence`, so a service's citations are whatever other repos cite
  when they reference it. Not a gap in ingest — a gap in the schema, left alone.
- **`seed:demo` ingests in-process rather than over HTTP.** §12 says "through
  the real `POST /api/ingest` path"; it calls the same `ingestManifest()` that
  endpoint calls, because §14's Phase 6 check runs `npm run seed:demo` before
  `npm run dev`, when no server is listening. It reads the manifests back off
  disk first, so what is committed is exactly what is verified.
- **The demo manifests declare `producer.kind: "parser"`.** They come out of the
  generator in this repository, not out of a scan of anything, and the ingest
  log should not claim otherwise.
- **Kafka edges in the demo carry `confidence: "medium"`.** Their call sites
  name a constant and the scan resolved it one file away, which is precisely
  the schema's definition of medium. Everything else is `high`, where the
  evidence states the fact outright.

## Link pass and search

- **The search index is rebuilt wholesale after each ingest.** §5 says "for the
  affected subjects", but one repo's manifest can change another repo's node
  through ownership, so "affected" is wider than it looks; at estate scale the
  whole rebuild is a few hundred rows.
- **An edge is indexed if it has a description *or* evidence.** §7 says "per
  edge (with a description)", invariant 6 says evidence snippets must be
  searchable. Indexing on either satisfies both.
- **`kind:` filters on the id prefix.** Every node id already carries its kind
  (`topic:`, `db:`, …), so nothing has to be stored twice and the FTS5 table
  keeps the columns §4 created. An unrecognised kind returns nothing rather than
  being silently dropped — a filter that quietly does nothing is worse than an
  empty result.
- **A bare `kind:topic` lists that kind** instead of returning nothing, because
  MATCH needs a term and "show me the topics" is a reasonable thing to type.
- **The search hit's highlight field is `snippet`, per §8.** The shipped client
  called it `excerpt`; the client was changed, not the API.

## API

- **`/api/graph` had a bug and it is fixed.** The BFS added to the frontier
  while iterating the edge list, so one pass walked the whole connected
  component and `depth=1` returned everything. Each hop now collects into its
  own set. §14's "only its direct neighbours" check is what caught it.
- **`depth=0` means the whole component**, as §8 says it does; it previously
  meant zero hops.
- **`/api/node` grew three fields** the per-kind detail pages need:
  `edgeEvidence` (citations keyed by edge id), `viaContract` (edges naming this
  node as their payload), and kind-aware `bindings` — a topic's are the bindings
  of the contract it carries, which is the screen where skew matters.

## Frontend

- **No separate `/drift` route.** §9's fixed nav was superseded by the page and
  widget system that shipped in the shell, and §0 lists that shell as done.
  §10's drift requirements — grouped by kind, expandable to the participating
  nodes and their evidence, a real empty state — are met by the `drift` widget,
  which is what the seeded Health page shows.
- **An unpinned map follows the filter row for both focus and depth**; one
  pinned to a node by its widget options carries its own depth, and the depth
  quick-control is hidden when there is nothing pinned, because a control that
  cannot affect what you are looking at is a lie.
- **`zoomOnDoubleClick` is off.** d3-zoom's own double-click handler calls
  `stopImmediatePropagation` on the pane, so React never sees the event and
  double-click-to-re-focus silently did nothing.
- **elk is imported on demand.** Its bundle is larger than the rest of the app
  put together and nothing needs it until a map is drawn. elk itself was kept —
  the fallback to dagre in §2 was never needed.
- **Nodes are a uniform 46px tall.** A row of nodes at different heights reads
  as meaning something it does not.
- **Selecting a node dims the ones it does not touch.** Not in §11; a dense
  graph is unreadable without it and it reverses on the next click.
- **The legend lists only the kinds on screen.** A legend for absent things is
  noise.
- **`.card-body` gets `overflow-x: auto`, added in `graph.css`.** A table wider
  than its card scrolls inside the card; the page never scrolls sideways.
  `app.css` and `theme.css` are untouched.

## Layer B — processes (phases 7–11)

### The migration

- **The legacy `DROP TABLE` is guarded, not unconditional.** SPEC-PROCESSES §3
  says to drop `processes` and `process_steps` "at the top of the schema block".
  Taken literally that runs on every boot and throws the real processes away
  every time the server restarts. It now fires only when the legacy shape
  (a `key` column) is what is actually there, which is what the sentence after
  it — "so an existing database picks up the new shape" — is asking for.

### Ingest

- **Superseded packs stay in the log, so the derived rows go explicitly.** §4
  says a superseded pack's rows "cascade away", but a cascade only fires on
  DELETE and the pack row is kept for the ingest log, exactly as a manifest is.
  `DELETE FROM processes WHERE pack_id IN (…)` does it, the same way Layer A
  does.
- **`touches` is read back off the pack's raw body.** §3's schema has no column
  for it and only the link pass consumes it, so denormalising it would create a
  table nothing else would ever read.
- **`process-duplicate-code` is computed from the active packs, not the rows.**
  `processes.code` is unique and `id` is the primary key, so when two packs
  declare one code the row can only hold the last writer. The finding needs to
  see both, so it parses the packs. This is also why the insert is an upsert
  rather than a failure: a duplicate is a finding, and a finding cannot be
  raised by a transaction that rolled back.
- **ingest.js and processes.js import each other.** The sweep needs to route by
  shape and processes.js needs `edgeId()` and the shared ajv. Every reference on
  both sides is inside a function body, so nothing is touched until both modules
  have finished evaluating. The alternative was moving `sweepInbox` to a new
  module, which SPEC-PROCESSES §4 discusses as staying where it is.

### The link pass

- **Interactions re-resolve by their three parts, in SQL, not by re-hashing.**
  An edge's id IS `sha1(from|kind|to)`, so the row carrying those three values
  is by construction the one the author described. It gives the identical answer,
  keeps `edgeId()` as the single hashing rule (§12.8) by not hashing at all, and
  avoids link.js importing ingest.js. It has to re-run every pass because
  whether that edge exists is a fact about the topology, and the topology moves.
- **A component the map does not have never enters `process_components`.** The
  join is what the two layers agree on; the disagreement is a finding. Putting
  unresolved ids in the join would break `uncovered-component`'s arithmetic and
  put non-existent nodes in every components list.
- **Process findings name the process; `uncovered-component` names the node.**
  Every finding subject therefore has a page to open. The drift UI routes on the
  `proc:` prefix.
- **`process-no-detail` fires only for leaves**, since a parent with no
  component of its own is the normal case §5 explicitly declines to flag.

### API and UI

- **The §7 read API landed in Phase 9, not Phase 10.** §10's Phase 9
  verification asserts through `/api/node`, `/api/process` and `/api/search`,
  so the API is a dependency of the phase that comes before it in §9's list.
- **`?process=` is an absolute filter.** §7 says "the process wins as the filter
  and `focus` only selects", so a node outside the process is dropped even when
  it is the focus — the one place `focus` does not exempt a node.
- **The nav carries `Processes` (the tree) and a seeded `Process map` page.** §8
  asks for both a `/processes` page and a `processes` dashboard slug; naming them
  the same thing twice in one sidebar would be worse than either. The tree is
  under Find, beside Search, because that is what it is for.
- **Manifests became the ingest log for both kinds.** Packs arrive through the
  same inbox and route by shape, so they read side by side rather than needing a
  page of their own.
- **In a diagram an endpoint is drawn as the service that serves it.** §8 says
  participants are the distinct services; `api:pricing-service/GET /v1/rates/{}`
  carries the service name in the id by construction, and "gateway →
  pricing-service" reads as a call where "gateway → GET /v1/rates/{}" does not.
  Topics and stores stay as participants of their own, because that is how an
  event flow is actually drawn.
- **`search_index` gained a `process` subject kind without a schema change.**
  The FTS5 table's columns are as §4 created them; the code goes into `body`
  twice, with and without its `L`, because people type both.

### The demo packs

- **The demo packs declare `producer.kind: "import"`.** They come out of the
  generator in this repository, not out of anybody's Confluence, and the ingest
  log should not claim otherwise.
- **Their structure is kept apart from their prose** in
  `server/scripts/demo/packs.mjs`. The structure is what §10 asserts; the prose
  is what the screens are designed against, and mixing them makes it easy to
  break the first while editing the second.

### The polish pass

Seven defects found by reading the code against the spec rather than by running
it. None was failing, because the demo packs are deliberately well-formed and
reach none of these paths; there is a fourth verification stage now (`packs`)
that does reach every one of them.

- **`seed:demo --remove` clears the database and leaves the files alone.** It
  used to unlink the thirteen committed fixtures under `demo/`, and
  `npm run verify` ends by running it — so verifying the build deleted tracked
  files out of the working tree. The paths are under `ROOT`, so `DATA_DIR`
  never protected them. Deleting the files is opt-in behind `--files`.
- **`process-missing-interaction` is suppressed only by its own ends.** §5
  suppresses it when a component underneath the process is missing, because
  there the missing component is the root cause. Read as "any missing
  component", a typo in an unrelated `touches` entry silently hid the more
  interesting finding. It is now suppressed only when one of the interaction's
  own two ends is the thing that is missing.
- **`processes` is a function of the active packs, rebuilt whole.** `processes.code`
  is unique, so when two packs declare one code the single row can only hold one
  writer — and the upsert transferred the row's `pack_id` to the newer pack.
  Re-ingesting that pack then deleted "its" rows, taking away a process the
  other pack still declared, with nothing to bring it back until that pack
  happened to be re-ingested. Replaying every active pack oldest-first is cheap
  at estate scale and cannot drift. `first_seen` is snapshotted across all
  processes rather than one pack's, and `last_seen` comes from each pack's own
  `ingested_at`, so replaying a pack nobody touched does not move it. Oldest
  first is well defined because `process_packs.id` is AUTOINCREMENT: the pack
  just ingested always has the largest id and is always the last writer.
  Deleting a pack has the identical hole — the cascade takes the row with it —
  so `rebuildProcesses()` is exported and `seed:demo --remove` calls it too.
- **An unresolved interaction no longer defames its two ends.** The process page
  took one boolean and struck through both components. On 3.2.3 both ends are
  real and one click away — the *relationship* is what the code does not have,
  which is the whole point of the finding. `/api/process` reports `node`,
  `edge`, `edgeFrom` and `edgeTo` separately now.
- **The rollup does not seed phantom parents.** An orphan code (3.4.1 with no
  3.4) rolled its components into `proc:3.4`, a row in the join for a process
  no page can open. The orphan code is the finding; the phantom was not.
- **A quarantine label is coerced to a string.** `pack` and `repo` are read off
  a body that has just failed validation, so they can hold anything; an object
  reached SQLite as a bind parameter it refuses and threw out of the ingest,
  taking the whole inbox sweep with it — one malformed file stopping every good
  one behind it.
- **The `process-children` widget is "Process parts", not "Process steps".**
  §12.3 is explicit that there are none.
- **`/api/prompt` fills placeholders everywhere except inside HTML comments.**
  Every prompt opens with a comment documenting its placeholders by name, and
  the renderer was filling those in — so the legend was destroyed and a second
  copy of the schema (14KB for the manifest, more for the pack) was pasted into
  the comment of every prompt the Scan page hands out. Worse in principle than
  in practice: a scanned component's description containing `-->` would close
  the comment early and spill the rest into the prompt body.

## Working

- **`npm run verify` was added** — SPEC.md §14 as a runnable check, over HTTP,
  against throwaway databases under `data/verify/`. Every §14 item that does not
  need a browser is in it.
- **The browser checks are committed as `npm run verify:ui`**, with Playwright
  as a root devDependency. The earlier session ran them from outside the repo to
  keep §2's dependency list exact; that made them unrepeatable by anybody else,
  which is a worse trade than one more devDependency. The script finds whatever
  Chromium build is on disk rather than the one its library expects, because in
  a container those are routinely out of step.
- **There is a fourth verification stage for what the demo estate cannot
  contain.** The demo packs are well-formed on purpose — §10 asserts exactly one
  missing component and exactly one missing interaction — so the paths for a
  duplicate code, an orphan code, a bare leaf, a malformed document and a
  re-ingest across packs were exercised by construction and by hand, never by
  the suite. Every one of them was a place a defect was found. They are
  asserted now, against synthetic packs at codes the demo does not use, in the
  same database as the demo estate so that the last two checks can prove the
  estate is unharmed by any of it.
