# Start here

You are building the Architecture Map. Read this file first, then get the app
running, then start at Phase 1. Nobody is available to answer questions — make
the call, write it down, keep going.

---

## 1 · Get it running before you read anything else

```bash
npm install
npm run dev
```

UI on http://localhost:5173, API on http://localhost:8787. You should see a
sidebar with five pages (Map, Estate, Messaging, Contracts, Health), a working
widget grid, and every widget showing an empty state. **That is correct.** The
shell is finished; the data underneath it is not.

Click around for two minutes before you write any code. Add a page. Add a
widget. Drag it. Open the ⚙ editor. Look at `/scan` and copy the prompt. This
is the machine you are filling, and you will make better decisions having seen
it work.

## 2 · Then read, in this order

| File | Why |
|---|---|
| [`AGENTS.md`](AGENTS.md) | How to work here. Short. Read it fully. |
| [`SPEC.md`](SPEC.md) | The build specification. §0 tells you what already exists, §13 is your task list, §14 is how you prove each phase. |
| [`schema/manifest.schema.json`](schema/manifest.schema.json) | The contract everything hangs off. Its `description` fields are the prompt Claude gets during a scan — read them as instructions, not documentation. |
| [`schema/example.payments-service.json`](schema/example.payments-service.json) | One valid manifest. Your Phase 1 fixture. |

Skim `reference/jira-reports/` for house style before your first component.
Never import from it; delete the folder in the final phase.

---

## 3 · What this is, and the four ideas behind it

A map of a service estate — services, Kafka topics, databases, caches, REST
endpoints, shared contracts — built from **manifests**: one schema-valid JSON
file per repository, describing what that service owns and what it talks to.
The app ingests manifests. It never scans anything itself.

Most architecture diagrams are wrong within a quarter, and once people catch
one lying twice they stop opening it. Four decisions exist to prevent that.
Understand them and most judgement calls answer themselves:

**Evidence is mandatory.** Every node and edge carries `repo`, `file`, `line`
and the source line verbatim. This makes a fabricated fact expensive to produce,
gives every screen a real citation, and turns staleness into something the app
can detect rather than something you find out during an incident.

**Ids are wire values, never labels.** A topic's id is the literal topic
string; a contract's is the fully-qualified class name or Avro subject. Two
repositories scanned in separate sessions, with no shared context, must emit the
byte-identical string for the same thing — otherwise nothing joins and you have
ten disconnected islands.

**Three layers stay separate.** *Topology* is derived from manifests and
rebuilt on every ingest. *Processes* (Layer B) are hand-authored and never
touched by a scan. *Overrides* are human corrections applied on read. Conflate
them and the next ingest eats somebody's work.

**Gaps are findings, not errors.** A consumer of a topic nobody produces is
either a boundary with another team or a dead listener. Both are worth knowing.
Never smooth one over, never invent a value to fill one.

---

## 4 · Start at Phase 1

Everything else is blocked on this, and finishing it lights up most of the app
at once.

**Finish the topology upsert in [`server/src/ingest.js`](server/src/ingest.js).**
Validation and quarantine are already done and tested. What is missing is the
`TODO` in `ingestManifest()`: inside one transaction, supersede this repo's
previous manifests, delete their derived rows, then upsert the service, nodes,
edges, evidence, unresolved entries and contract bindings. **SPEC.md §5** has
the exact sequence.

Three things in that function are easy to get wrong and expensive to discover
later:

- `edges.id` is `sha1(from|kind|to)` — it must not change when the same
  manifest is re-ingested with evidence in a different order, because overrides
  and process steps point at it.
- A contract's `version` goes in `contract_bindings`, keyed by service. Putting
  it on the `nodes` row destroys version-skew detection, which is one of the
  most valuable things this tool does.
- Re-ingest must be idempotent **per repo**: it replaces exactly that repo's
  contribution and touches nothing else.

Then work down SPEC.md §13: link pass → demo estate → search index → the map.

---

## 5 · The invariants

Violating any of these makes the product wrong rather than merely buggy.

1. **A quarantined manifest imports nothing.** No partial imports, ever. A
   half-imported manifest is indistinguishable from a real finding.
2. **Overrides survive ingest.** If a re-scan can revert a human's correction,
   the feature is broken regardless of what the tests say.
3. **`from` is always the scanned service.** `kind` carries direction.
   `flowDirection()` in `web/src/lib/nodes.ts` is the only place that reverses
   an edge for display — use it, never re-derive it.
4. **Node ids never appear in a URL path.** They contain `:`, `/`, spaces and
   `{}`. Query parameters only, both in the API and in routes.
5. **`near-miss` never auto-merges.** Report the suspected duplicate; a human
   decides. Silently merging ids is how a map starts lying.
6. **Evidence snippets are indexed for search.** Searching `@KafkaListener` or
   a table name must find the code. Indexing only names throws away most of the
   value.
7. **Empty states are real states.** No demo data leaking into a fresh install,
   no placeholder rows, no invented numbers to make a screen look populated.
8. **Graph layout is deterministic.** If a node moves between loads, the layout
   is wrong. No force simulation anywhere.
9. **Don't touch `web/src/styles/theme.css` values.** Validated palette. Add
   tokens; never retune existing ones.

---

## 6 · Prove it, then commit

Every phase in SPEC.md §13 has verification steps in **SPEC.md §14**. Run them.
They are all checkable without the real service repositories — that is what the
demo estate in §12 is for.

Two that matter more than the rest:

- After the demo seeder: `/api/drift` contains exactly one `no-producer` (for
  `topic:risk.flagged.v1`), exactly one `shared-database` (for
  `db:postgres/ledger`), and at least three `version-skew` findings.
- Set a `description` override on a node, re-ingest that repo, confirm the
  override is still there.

Commit per phase with the phase name in the message. Push to `main` as you go —
the work needs to be visible, not sitting in a local branch. Never force-push,
never rewrite pushed history.

If a verification step fails and you cannot fix it: leave it failing, record it,
and move to the next phase. Do not stop, and do not weaken the test.

---

## 7 · If more than one of you is running

Phases 1–3 are a chain and belong to **one** agent. Ingest, the link pass and
the demo estate depend on each other, and splitting them across agents produces
merge conflicts in the same three files.

Once Phase 3 is pushed, Phase 4 (search index) and Phase 5 (the map) are
genuinely independent — different files, no shared state. Take one each, branch
from `main`, and merge back when your verification passes.

Before starting anything, `git pull` and read the most recent `HANDOVER.md` and
`DECISIONS.md` if they exist. Another agent may have already made the call you
are about to make.

---

## 8 · Do not

- **Do not ask questions.** Choose the option most consistent with the
  surrounding design, add one line to `DECISIONS.md`, continue.
- **Do not rebuild the shell.** The sidebar, pages, widget grid, filter row and
  detail pages exist and work. Add a widget by adding a `WidgetDef` and a
  `WidgetBody` case in `web/src/dashboard/registry.tsx`. If you are writing a
  second Modal, a second table or a second fetch hook, go find the one that
  already exists.
- **Do not expand scope.** SPEC.md §1 lists what is deliberately excluded from
  v1 — Layer B process UI, AI search, auth, automated Claude invocation.
  Building them early is a defect, not a bonus.
- **Do not reach the network** beyond npm. The Bitpanda repositories are not
  available and cannot be fetched. Do not stub a scanner against imaginary
  repos, and do not weaken a check because real data is missing.
- **Do not change `schema/manifest.schema.json`** without recording why. It is
  a contract shared with every scan prompt already written.

---

## 9 · When you stop

Write `HANDOVER.md` at the repo root, per AGENTS.md: phases complete and which
verification steps you actually ran; anything failing, with the error and what
you tried; your judgement calls; the commands to run it; what you would do next,
in priority order.

Be accurate rather than encouraging. If the map does not lay out properly, write
that the map does not lay out properly. Someone will read this before touching
the code and would much rather know.
