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

**`/api/graph`'s default excludes contracts, and §14's count asks for them.**
§8 says "`kinds` — comma-separated node kinds to include. Default: all but
`contract`", with the reason: contracts clutter the default view and are opt-in.
§14 then asserts that `GET /api/graph?focus=svc:order-service&depth=1` returns
11 nodes, "verify the count by hand against §12" — and the by-hand count
includes `contract:com.meridian.events.OrderMatched`, which the default would
drop. The two clauses are about different things: §14's is an adjacency check,
§8's is a default. Both are implemented and both are asserted — the adjacency
with every kind asked for, the §8 default beside it. The filter row's Show
picker, whose empty state now means what the API means, reads "All but
contracts" rather than "Everything".

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
  The rows therefore have to go without one. This started as
  `DELETE FROM processes WHERE pack_id IN (…)`, the same way Layer A does it,
  and that turned out to be wrong for a reason Layer A does not have: see
  **`processes` is a function of the active packs, rebuilt whole** in the polish
  pass below, which is what the code does now.
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

### The review pass

Twenty more defects, from six review dimensions read against the spec with every
finding put to three skeptics told to refute it. Most were plain bugs and are in
the git log rather than here. Three were judgement calls:

- **`/api/graph`'s `repos` filter exempts the focus, as `kinds` does.** A focused
  map whose focus is owned by another repo would otherwise come back empty, and
  the same exemption is already how every other filter on that endpoint behaves.
- **The Show picker's empty state reads "All but contracts".** It used to say
  "Everything" and the server used to mean it. Now that the API honours §8's
  default, an empty selection excludes contracts — so the label had to say so.
  Contracts are still one tick away, which is what "opt-in" means.
- **A dropped file is ingested through the API, not written to `inbox/`.** §10
  asks the Scan page for a drop zone. There is no upload endpoint and adding one
  would mean the browser writing into a directory the sweep owns; instead the
  document is routed by shape — `repo` to `/api/ingest`, `pack` to
  `/api/ingest/process-pack` — which is the same rule `inboxKind()` applies, and
  gets the same validation and the same quarantine.
- **The coverage widget shows the deepest level present, not level 3.** Filtering
  to level 3 was a de-duplication: the rollup means a component reached by a
  level 3 is also listed under its ancestors. But a component named directly by
  a level 1 — which §5 allows — then had no chip at all, while the summary line
  counted it as covered. The most specific level present keeps the
  de-duplication and cannot be empty.

### The Layer B review

- **§5's `exposes` rule keeps every exposer, not one of them.** The rule reads
  "the service that exposes it", singular, because that is the expected
  topology — but it is expected, not guaranteed, and Layer A already models and
  reports two services claiming one route. The rule's deliberate limit is that
  it stops at endpoints and does not generalise to topics or stores; it was never
  about picking one service. With a single exposer the output is byte-identical.
- **A focus inside a process walks the process's own edges.** §8 says "the
  existing focus/depth controls still work within that subgraph", and walking the
  estate and intersecting afterwards is not the same thing: it counts hops
  through components the process does not contain. A focus the process does not
  contain now selects nothing, so the filter stands alone and the whole process
  comes back — "the process wins as the filter and `focus` only selects", with
  nothing to select.
- **`DRIFT_KINDS` moved to `web/src/lib/drift.ts`.** The drift widget and the
  process page list the same findings, and the page was printing the raw `kind`
  slug. One table, two readers, rather than a copy in each.
- **A `root` that is not a process code is a 400.** The value reaches a LIKE
  pattern, so `%` and `_` are wildcards and a typo returned a subtree nobody
  asked for. Parameterising it was never the issue; validating the grammar is.
  Same for `maxLevel`: a non-number bound into `level <= ?` matches nothing, and
  an empty tree is a worse answer than saying what was wrong with the request.
- **Every `{{…}}` substitution goes through a replacer function.** In the
  two-argument string form `$&`, `` $` ``, `$'` and `$n` are expanded as
  patterns, and the values here are a query parameter, a schema file and rows out
  of the database. The pack box on /scan is free text, so a pack id of `` $` ``
  spliced the whole prompt back into itself.

## Layer C — teams and handoffs (phases 12–16)

- **`teams.json` is per deployment; `demo/teams.json` is the fixture.** The live
  registry is an org chart somebody maintains, so it is gitignored like
  `repos.json`, and `seed:demo` creates it only when there is not one already —
  seeding a demo is not a reason to overwrite it. What the verification runs
  against is the committed fixture under `demo/`, through `TEAMS_FILE`, so a
  stage never depends on what this machine happens to have at the root.
- **A team the data mentions still gets a row**, marked `registered = 0` with a
  `source` saying whether a manifest or a pack named it. Dropping it would leave
  a component showing a bare id with nowhere to click; keeping it is what lets
  `unknown-team` be a finding rather than an absence.
- **`process_teams` holds reach BEYOND the process's own team.** A process's own
  team's components are in `process_components` already and are not a crossing.
  The table is about where the process leaves the team and what carries it
  there, which is why it is small enough to be one query per screen.
- **A declared handoff over HTTP scores `component`, not `none`.** It is never
  derived, so reporting on `derived = 0` would have fired on every synchronous
  handoff an author wrote down — which is precisely the case the field exists
  for. Only a claim whose two processes do not touch a single directly-named
  component between them is reported.
- **Handoffs on a page collapse to the reader's altitude.** One handoff exists
  at every level of both its ends, so a level 1 showed three rows saying the
  same thing. Collapsed on the counterpart AND the carrier, because a pair that
  genuinely hands off over two topics is two facts.
- **`cross_team` stays two-valued.** A link with a teamless end is "unknown"
  rather than "internal", and a third state would touch every query and every
  filter. With a process inheriting its nearest ancestor's team, the only way to
  reach the unknown state is an entire level 1 subtree with no owner anywhere —
  which `process-no-owner` already reports at the level that matters.
- **The map's colour is a mode, not a second encoding.** Node kind owns six of
  theme.css's eight categorical slots and that file may not be touched, so
  "colour by team" cannot coexist with "colour by kind". Past the eighth team
  the nodes are muted and the legend says how many, because the tokens are
  documented as never cycled and wrapping them would put two teams in one colour
  with nothing telling the reader.
- **The team matrix is a DataGrid, not a chart.** It is a table of counts, the
  house style has a table, and a cell that is a link is worth more than a cell
  that is a shade.

## Isolating, arranging, and the chord

- **Isolation is transient, and the filter row is not.** `focus` and `depth`
  ask the server what the graph *is*; isolate asks what is already on screen
  what to keep. One click, no refetch, no URL, and it works inside a widget that
  has no filter row — which is the difference between "what does this map cover"
  and "I cannot read this screen".
- **It is applied last, over what the key left.** Hiding a kind and then
  isolating means two hops through what you can see, not two hops through
  things you switched off and out the other side.
- **The walk is undirected.** "What does this topic connect to" means its
  producers and its consumers, and isolating an endpoint has to keep the
  service that serves it as well as the ones that call it. The direction is on
  the arrow once they are both on screen.
- **The way out is on the canvas, not in the key.** A mode you entered with one
  click and cannot see is a mode people get stuck in.
- **Teams groups with `SEPARATE_CHILDREN`, not `INCLUDE_CHILDREN`.** Letting
  the layers run through the boxes puts one team's nodes in four layers and
  drags its box across the whole width — 3191×1156 for the demo estate against
  1460×878 the other way. The boxes are the point of that arrangement, so the
  boxes are what it packs.
- **A group box is not a React Flow parent.** A parent re-bases its children's
  coordinates, which would fight both the saved hand-placed positions and the
  drag that produces them. It is an ordinary node, sized by the layout, painted
  behind and deaf to the mouse.
- **Columns is computed, not laid out.** A column per kind has no crossings to
  minimise and no layers to assign — it is an ordering, and doing the
  arithmetic directly makes it instant, exactly reproducible and readable as
  arithmetic.
- **A hand-placed arrangement is per map, per detail level and per
  arrangement.** A drag made against the compact layout means nothing against
  the columns, so it is not applied to it.
- **The chord's geometry is written here rather than imported.** It is one page
  of trigonometry; d3-chord is the reference implementation and this is the
  same arithmetic with the theme tokens applied directly rather than bent back
  afterwards. The repository keeps its six runtime dependencies.
- **An arc is sized by everything that happens at a service, sent and received
  together.** d3's default sizes a group by its outgoing row alone, which gives
  a service that everybody calls and that calls nobody no arc at all — and on
  an estate map that is the one thing the picture may not drop.
- **Arcs are ordered by team, then by name — never by traffic.** An arc that
  moves when a filter changes takes its ribbons with it and the picture has to
  be re-read from scratch. Team order is also what makes a cross-team bundle
  visible as a bundle.
- **Ribbons are outlined in the surface colour, not their own.** A dozen of them
  overlap in the middle of the circle and without a gap between them they read
  as one shape.
- **The chord is always service-to-service**, whatever the map's detail level
  says, so its key is drawn from the collapse rather than from the current view
  — which at full detail holds scanned edges with no relation on them and left
  the key empty.
- **`Fewest crossings` turned out to be the fast one.** Thoroughness is a
  search budget so it ought to be the slow one; the wrapping `compact` does
  costs more than the search. 341ms against 633ms on the demo estate, and about
  half the way up to 258 nodes. The label was corrected once it was measured
  rather than assumed.
- **The key can be shut and the way to the chord lives in it**, so the shut
  state carries the view toggle too. Without that, shutting the key on the map
  is a door locking behind you.

## Five diagrams, and `next`

- **`next` is the departures from the numbering, never the sequence.** The code
  has always carried the order, so a step with no `next` still falls through to
  the next sibling and a pack written before this existed draws exactly the
  straight line it always described. `next` says only what a number cannot: a
  condition, a jump, a stop. The corollary is a rule for authors — a `next` that
  restates the numbering is noise the first renumbering will break — and it is
  in the prompt.
- **A branch is the same shape as a handoff, and follows the same rules.**
  Read off `process_packs.raw` by the link pass rather than given a column, for
  the reason SPEC-PROCESSES §3 already gave for `touches`; resolved into a
  rebuilt-whole table; and a target nobody has written is kept with
  `resolved = 0` and reported, never rejected. Consistency here was worth more
  than any of the alternatives.
- **A branch to the process it leaves is dropped.** It is the one loop nobody
  means — a self-arrow that mermaid draws as a circle and a reader reads as a
  bug in the tool. A branch back to an *earlier sibling* is kept: that is a
  retry, and it is how a retry is written.
- **A branching step is not a rhombus.** The convention assumes a short
  question — "Permitted?" — and every label here is a sentence, which inflates
  a diamond to three times the area of the box beside it and turned a four-step
  diagram into a scroll. The condition sits on the arrow, which is where it
  belongs, and the split is visible because the arrows split.
- **A terminal node is drawn only if something reaches it.** Where every arm
  ends in an outcome the author wrote, the process's own `outcome` node is an
  unreachable box floating beside the diagram — which is what it was.
- **Lanes pick their own dimension, and say which.** By team where more than one
  team is involved, because that is the boundary worth seeing; by component
  where one team does everything, because a swimlane diagram of a single
  swimlane is a flowchart with a box round it. Where even that gives one lane,
  the tab is not offered at all.
- **A tab with nothing behind it is worse than a missing tab.** It teaches the
  reader that the diagrams are unreliable. A level 3 decomposes into nothing, a
  process that hands off to nobody has no handoff picture, and a decomposition
  that is just the children fanned out is the list above it drawn worse.
- **The handoff diagram keeps the deepest far end.** The rollup emits one row
  per ancestor of the other end — `2 → 3`, `2 → 3.1` and `2 → 3.1.2` are one
  crossing said three times — so only the deepest is drawn. And one box per
  process however many rows name it: a rolled-up row carries the *leaf* pair's
  teams, deliberately, which put "L2 Order and execution" in two different team
  lanes at once.
- **One card, one control.** The same rows drawn five ways are one thing on the
  page, not five cards. The `process-flow` widget takes the same choice as an
  option, and falls back to the sequence diagram rather than showing an empty
  box when its process cannot draw what it was pinned to.
- **The seven Layer C findings finally have titles.** `unknown-team`,
  `component-no-team`, `multi-team-topic`, `process-no-owner` and the three
  `process-link-*` kinds all still arrived on the Health page as bare slugs,
  which is the exact defect the polish pass fixed for Layer B and never came
  back to finish.

## Editing the registry — rename, merge, assign

- **A merge is an alias and nothing else.** `teams.json` gains `aliases`, and
  everything that reads a team out of the data resolves through them. Nothing is
  rewritten and nothing is deleted: the manifests still say what the scan found,
  and the registry now says what that meant. Removing the alias undoes it. This
  is what `teamId()`'s own comment already argued — *the registry, not a
  heuristic, is what says one name was meant to be another* — made writable. The
  alternative, writing a team override onto every affected node, misses
  processes (which carry `owner`, not a node) and un-merges itself the next time
  the old name is scanned.
- **A rename moves the id only when the id came from the name.** `john-smith`
  called "John Smith" is an id derived from a name, so renaming it to "Payments"
  moves it to `payments` and keeps `john-smith` as an alias. A hand-written entry
  whose author gave `platform` the name "Platform Engineering" has already said
  the two are not the same thing, so it keeps its id. The editor states which
  will happen before the request is sent, because an id is what every link,
  filter and saved view joins on.
- **Renaming onto an existing team is refused, not silently merged.** The editor
  offers the merge instead. A rename that quietly folded two teams together is a
  merge nobody asked for.
- **`teamId()` is stated twice, and a browser check holds the two together.**
  The editor cannot say what the id will become without the rule, and a round
  trip per keystroke to ask the server is worse than a second statement of a
  four-line rule that SPEC-ORG §2 publishes as a contract. `verify:ui` renames a
  team and asserts that what the client predicted is what the server did.
- **The server writes `teams.json`, and carries through what it does not
  understand.** Temporary file, atomic rename, unknown keys preserved: somebody
  hand-editing the registry and somebody renaming a team on the Teams page are
  editing the same file. A file that exists and does not parse — or whose `teams`
  is not a list — is never written, because the edit would be applied to `{}` and
  everything in it would be lost.
- **An absent registry is created by the first edit, and the editor says so.**
  From then on every other team is reported as unregistered. That is the point of
  having a registry, and it is still a surprise if nothing warns you.
- **Assigning a service to a team needed no new mechanism.** `overrides` with
  `field='team'` already existed and `resolveTeams()` already gave it precedence
  over the manifest; what was missing was anywhere to write one. It is now on the
  node page beside the description, and in bulk on the Teams page — which is the
  screen for the morning after a forty-repo scan.
- **Only a service is offered a team.** A topic's comes from its producer and a
  store's from its owner, so an override on one of those would show a correction
  on the page while every derived column went on saying the other thing. An
  inherited team gets a link to where it came from instead.
- **`teamVia` is a field, not an inference.** `scan`, `inherited`, `override` or
  nothing. Without it there is no visible difference between a team the scan
  found and a team a person typed, and "revert to the scan" is a button that
  cannot say what it would undo.
- **Both verification suites now run against a *copy* of `demo/teams.json`.**
  The registry became writable, and `verify:ui` renames and merges teams in it:
  pointed at the repo root it would edit whatever real org chart is on the
  machine, and pointed at the fixture it would edit the thing it is asserting
  against.

## The map's two detail levels

- **The collapse is derived on the client and never stored.** Service → service
  is not a fact the scan found; it is an inference from two facts it did find.
  Writing it to `edges` would make it indistinguishable from a scanned edge and
  put it in the drift pass, the search index and every count. It lives in
  `web/src/graph/collapse.ts`, is recomputed per render, and every line keeps
  the ids it came from so a click can cite them.
- **Three kinds of relationship, not one and not five.** Events (a topic),
  calls (an endpoint) and shared stores (a database or cache). `depends.on`
  and `topic.schema` are deliberately excluded: collapsing shared contracts on
  the demo estate gives 40 pairs out of a possible 45, which draws a line from
  everything to everything and says nothing. The three kept give 14, 9 and 6.
- **Each derived line takes the colour of what it swallowed** — a topic's for
  an event, an endpoint's for a call, a database's for a store — so switching
  detail levels does not recolour the estate. A shared store is dotted rather
  than solid because nobody chose it as an interface and it should not look
  like a call.
- **Externals are not collapsed, but they are still calls.** A call to Stripe
  has nothing on the far side to collapse into, and "who do we depend on
  outside" is one of the questions the service view is for — so the edge
  survives as itself. It is still drawn and switched off as the call it is: a
  key row that claims a kind of line has to cover every line of that kind.
- **A service nothing connects to is still drawn.** An island is a finding.
- **The estate opens collapsed, a process map opens whole.** A process's
  components *are* its topics and stores; collapsing them would leave a diagram
  of two services. The choice is remembered per map.
- **What the key hides is scoped to the encoding the key is showing.** Hiding a
  team while colouring by team, then switching to Kind, un-hides it: a control
  that is hiding something must stay in front of you. The key is also drawn
  from what the level *could* show rather than what survived the toggles, or a
  row switched off would vanish with no way back.
- **Nothing hidden is remembered across a reload.** Detail level and hand-placed
  nodes are; a hidden kind is not. Coming back to a map with half the estate
  missing and no memory of having done it is the worst of the three.
- **An arrangement is per map and per detail level.** Two maps on a page are two
  maps, and the two levels do not share a node set, so they cannot share an
  arrangement. `Reset layout` appears only when there is something to reset.
- **The layers wrap past 1.7:1.** Laid out in one run, the demo estate at
  service level is 1968×214 — a ribbon of specks in a landscape panel. elk's
  layered wrapping folds it to 1226×715 for the same input, deterministically,
  and leaves a graph that is already squarer exactly as it was. Still layered,
  still never force.

## Scale, and four things that were not true

- **A busy intermediary is kept as a node rather than collapsed.** Collapsing
  asserts a line per producer per consumer, which is right for the shape most
  intermediaries have — one publisher, a handful of listeners — and wrong for
  the ones every estate grows. Eight producers and eight consumers of one audit
  topic is sixteen services sharing a bus, not sixty-four conversations. Past
  twelve lines the intermediary stays on the map and its own scanned edges are
  drawn: `p + c` instead of `p × c`, and nothing invented. The threshold is a
  judgement call; the demo estate's widest expansion is four, so it sits well
  clear of anything real there.
- **elk runs in a worker, against a ten-second deadline, rather than behind a
  node-count guard.** A guard needs a number that separates "fine" from "never
  finishes", and there isn't one: a synthetic 122-node estate took 16s where a
  152-node one took 12s. Cost follows shape. A clock needs no such number, and
  a worker that blows it is terminated because nothing else can stop it.
- **A derived line's confidence is the weaker of its two legs, and the better
  of its routes.** A route is only as good as its weakest part; but where two
  intermediaries connect one pair, the claim is that the pair is related, and
  one solid path establishes that. It used to be `'high'` unconditionally.
- **near-miss no longer strips a version suffix.** It made `orders.matched.v1`
  and `.v2` normalise alike and reported a migration as a typo. The case the
  rule was written for — `users.created.v2` against `UsersCreatedV2` — still
  collapses, because separators and case are all it takes. Nothing now reports
  two live versions of a topic at all; both are nodes on the map, and a wrong
  finding is worse than a missing one.
- **A finding's identity is `sha1(kind | subject | detail)`.** The table is
  deleted and rebuilt on every link pass, so identity had to be derived from
  content. Including the wording is deliberate: "3 repos claim this" and "5
  repos claim this" are different situations, and an acceptance of the first
  should not silently cover the second.
- **A finding is routed to a team the way a node is.** Its subject's team,
  the owning team if the subject is a process, the team itself if it is a team,
  and otherwise the team of the services around it when they agree. That takes
  the demo estate from 1 finding of 15 carrying a team to 10. The five left
  over are a topic two teams publish and three version skews — more than one
  team is the finding in each, so naming one would be picking a side.
- **`counts.drift` still means what the link pass found; `counts.driftOpen` is
  the one that moves.** Redefining the existing count to exclude accepted
  findings would change the meaning of a number §14 asserts and that people
  may already be reading. The new one is additive, and the stat tile offers
  both.
- **An accepted finding is greyed and moved to the end, not hidden.** Hiding it
  would move a count for a reason the reader cannot see, and it has not stopped
  being true.
- **The chord layout module is `chordLayout.ts`, not `chord.ts`.** Beside
  `Chord.tsx` the two names are one import specifier on a case-insensitive
  filesystem, and `.ts` is tried first, so `./Chord` resolved to the geometry
  and the app rendered nothing on a Mac. Renaming the module is the fix rather
  than adding an extension to the import, because the next file added beside
  them would hit it again — which is also why the `map` stage now refuses any
  two modules that differ only in case.
- **The `map` verification stage imports the app's own TypeScript.** Node reads
  `.ts` directly but not Vite's extensionless imports, so the stage registers a
  resolver hook for its own process rather than putting `.ts` suffixes through
  the app to suit a test. The alternative — a copy of the collapse rules in the
  test — is the thing most likely to drift from what ships.

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
