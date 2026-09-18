# Decisions

Judgement calls made while building SPEC.md §13, one line each with the reason.
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

## Working

- **`npm run verify` was added** — SPEC.md §14 as a runnable check, over HTTP,
  against throwaway databases under `data/verify/`. Every §14 item that does not
  need a browser is in it.
- **The four Phase 5 checks were run in a real browser** (Chromium at 1280×900)
  but are not committed. They need Playwright, which is not one of §2's
  dependencies and has no business in a fresh `npm install`. HANDOVER.md says
  what was run and what it showed.
