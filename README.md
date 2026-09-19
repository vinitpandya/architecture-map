# Architecture Map

A local-first map of a service estate — services, Kafka topics, databases,
caches, REST endpoints and the shared contracts between them — built from
evidence in the source code, with a file and line behind every claim.

```
  repos  ──scan──▶  manifest.json  ──▶  inbox/  ──ingest──▶  architecture.sqlite  ──▶  web
                    (one per repo)                             nodes · edges
                    schema-validated                            evidence · drift
```

The app never scans anything itself. It ingests **manifests**: JSON files
conforming to [`schema/manifest.schema.json`](schema/manifest.schema.json), one
per repository. A manifest can come from Claude reading the repo, from a
deterministic parser over build files and migrations, or from a human writing
one by hand — the app cannot tell the difference and does not need to.

**And what the business does with it.** A second layer holds the L1/L2/L3
process hierarchy — which spans repositories and Kafka hops — and the components
each process uses. It arrives as **process packs** conforming to
[`schema/process-pack.schema.json`](schema/process-pack.schema.json), written by
people, because the knowledge is not in the codebase to be scanned.

A pack only ever *references* components a scan already found. It can never
create one. That is what makes the two layers check each other: a process
claiming to use something the code does not have is a finding rather than a
fiction, and so is a process describing a call no repository makes.
Specification: [SPEC-PROCESSES.md](SPEC-PROCESSES.md).

## Quick start

```bash
npm install
npm run seed:demo     # the fictional Meridian estate — ten services
npm run dev
```

- UI → http://localhost:5173
- API → http://localhost:8787

Without the seeder every screen comes up in an empty state, which is correct:
nothing has been ingested. `npm run seed:demo -- --remove` clears it out of the
database again, leaving the generated files under `demo/` alone; add `--files`
to delete those too.

```bash
npm run verify        # SPEC.md §14 and SPEC-PROCESSES.md §10 — 307 assertions
npm run build && npm run verify:ui   # the checks that need a browser — 93 more
npm run validate -- inbox/payments-service.json
npm run build && npm start           # production build, UI and API on one port
```

## What is here

| Page | |
|---|---|
| **Map** | The estate as a graph. Focus, depth, kinds and repos across the top; a node inspector on the right. Click to select, double-click to re-focus — the back button undoes it. |
| **Estate** | Counts, the service and topic lists, and what has been scanned. |
| **Messaging** | Topics, and producers against consumers for whichever one is in focus. |
| **Contracts** | Who binds which version of what, and where they diverge. |
| **Process map** | The hierarchy beside the map, the parts of whichever process is selected, and what no documented process accounts for. |
| **Health** | Drift findings, unresolved references, orphans, quarantined manifests, coverage. |
| **Processes** | The L1/L2/L3 tree. Click through to a process for its parts in order, the components it runs through, and where the claim came from. |
| **Search** | Names, ids, descriptions — and the evidence snippets, so `@KafkaListener` or a table name finds the code. |
| **Scan** | The repository list, the rendered scan prompt to paste into Claude, and the inbox. |
| **Manifests** | The ingest log for both kinds — scan manifests and process packs — with quarantined rows expanding to their validation errors. |

Every page is a grid of widgets you can add, drag, resize, configure and
full-screen, and you can make your own pages beside the six built-in ones.
Clicking anything lands on a detail page for that node, which is shaped by what
the node is: producers and consumers for a topic, owner/writers/readers for a
database, every binding version for a contract — and, on all of them, the
business processes that run through it.

Pick a process in the filter row and the map draws only that process: every
service, endpoint, cache and topic it runs through, across every repository.
A process also renders as a sequence diagram generated from its own parts,
which is where this project started — except now the diagram is generated from
data that is checked against the code.

## The four ideas

**Evidence is mandatory.** Every node and edge carries `repo`, `file`, `line`
and the source line itself. That makes a hallucinated fact expensive to produce,
gives every screen a citation, and turns staleness into something the app can
detect rather than something you discover in an incident.

**Ids are wire values, not labels.** A topic's id is the literal topic string; a
contract's is the fully-qualified class name or Avro subject. Two repositories
scanned in separate sessions have to emit the same string for the same thing, or
nothing joins.

**Three layers stay separate.** *Topology* is derived from manifests and rebuilt
on every ingest. *Processes* are hand-authored and never touched by a scan.
*Overrides* are human corrections applied on read — ingest never touches them,
which is why a re-scan cannot eat somebody's work.

**Gaps are findings.** A consumer of a topic nobody produces is not an error to
be smoothed over — it is either a boundary with another team or a dead listener,
and both are worth knowing. The findings page is where the map proves it is
still honest.

**The two layers cross-check each other.** A documented process pointing at a
component the topology does not have means either the scan missed something or
the document has gone stale. A process describing a call that exists in no
repository means the same. Nothing else in the estate can catch either, and it
only works because a pack is never allowed to create the thing it is missing.

## Scanning a repository

The app renders the prompt; a human runs it:

1. Copy `repos.example.json` to `repos.json` and list your repositories.
2. Open **Scan**, pick a repo, copy the pass-1 prompt
   ([`prompts/scan-pass1.md`](prompts/scan-pass1.md) with the schema inlined).
3. Run it with Claude inside a checkout of that repository.
4. Drop the resulting JSON in `inbox/` and press **Sweep inbox**.

Validate before ingesting if you want a faster error:

```bash
npm run validate -- inbox/payments-service.json
```

Nothing about the app depends on *how* the JSON arrives, which is deliberate —
running the CLI by hand, shelling out to `claude -p`, or calling the API with
structured outputs are all interchangeable, and the choice can change later
without touching the app.

Ingest is idempotent per repository: re-ingesting one replaces exactly that
repo's contribution, keeps `first_seen`, and leaves every other repo and every
human correction alone.

## Authoring processes

Same shape, different prompt. Open **Scan**, switch to the **Processes** tab,
name a pack and copy the prompt — it carries every component currently in the
map and every process code already in use, because its central rule is that a
pack may only reference components a scan has already found. Run it with
whatever describes the processes: a Confluence export, a mermaid diagram, a
runbook, an interview. Drop the JSON in `inbox/` and sweep.

The inbox routes by shape: a `repo` property means a scan manifest, a `pack`
property means a process pack. One drop point, nothing to remember.

## The demo estate

`demo/manifests/` holds ten committed manifests describing **Meridian**, a
fictional trading platform, and `demo/processes/` holds three process packs
over it — 46 processes across onboarding, order and execution, and reporting.
They exist because the real service repositories are not available to the build,
and they are what every layer is verified against.

The estate deliberately contains a topic nobody produces, a database two
services write, three contracts bound at different versions, and three
references a scan could see but not resolve. The packs deliberately contain two
more: a process consuming a topic that no longer exists, and a process
describing a call no repository makes. Those two are the whole argument for the
second layer.

`server/scripts/demo/estate.mjs` and `packs.mjs` are that data; changing either
changes what `npm run verify` asserts.

## Repository layout

| Path | |
|---|---|
| `schema/` | The ingest contract, and a worked example |
| `prompts/` | Scan prompts, versioned — pass 1 per repo, pass 2 across manifests |
| `server/src/` | Express + SQLite: `ingest.js`, `processes.js`, `link.js`, `routes.js`, `db.js` |
| `server/scripts/` | `validate.mjs`, `seed-demo.mjs`, `verify.mjs`, `verify-ui.mjs` |
| `web/src/graph/` | The map and the process diagram: React Flow, elk, mermaid |
| `web/src/dashboard/` | The widget grid and registry |
| `demo/manifests/` | The fictional estate the app is verified against |
| `demo/processes/` | The process packs over it |
| `inbox/` | Drop manifests here (gitignored) |
| `data/` | `architecture.sqlite` (gitignored) |

[SPEC.md](SPEC.md) is the build specification, [DECISIONS.md](DECISIONS.md)
records the judgement calls made against it, and [HANDOVER.md](HANDOVER.md) says
what is verified and what is not.

## Not built

Semantic search, any form of authentication, and any automated invocation of
Claude — the app renders prompts and a human runs them, which keeps how the JSON
is produced interchangeable.

Nothing re-reads a cited `file:line` to check the snippet still matches, so a
fact is true as of its scan rather than provably still true. The schema already
promises that check and `drift.stale-evidence` is reserved for it;
[HANDOVER.md](HANDOVER.md) has it at the top of what to do next.
