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
npm run verify        # §14, SPEC-PROCESSES §10 and SPEC-ORG §10 — 318 assertions
npm run build && npm run verify:ui   # the checks that need a browser — 93 more
npm run validate -- inbox/payments-service.json
npm run build && npm start           # production build, UI and API on one port
```

## What is here

| Page | |
|---|---|
| **Map** | The estate as a graph, at either of two detail levels. Focus, depth, kinds and repos across the top; a node inspector on the right. Click to select, double-click to re-focus — the back button undoes it. |
| **Estate** | Counts, the service and topic lists, and what has been scanned. |
| **Messaging** | Topics, and producers against consumers for whichever one is in focus. |
| **Contracts** | Who binds which version of what, and where they diverge. |
| **Process map** | The hierarchy beside the map, the parts of whichever process is selected, and what no documented process accounts for. |
| **Health** | Drift findings, unresolved references, orphans, quarantined manifests, coverage. |
| **Processes** | The L1/L2/L3 tree. Click through to a process for its parts in order, the components it runs through, and where the claim came from. |
| **Teams and handoffs** | Who is responsible, by department. Where one team's work ends and another's begins, and which teams depend on which. |
| **Teams** | Every team the registry and the data know about, editable, plus every service and the team it belongs to. |
| **Search** | Names, ids, descriptions — and the evidence snippets, so `@KafkaListener` or a table name finds the code. |
| **Scan** | The repository list, the rendered scan prompt to paste into Claude, and the inbox. |
| **Manifests** | The ingest log for both kinds — scan manifests and process packs — with quarantined rows expanding to their validation errors. |

Every page is a grid of widgets you can add, drag, resize, configure and
full-screen, and you can make your own pages beside the six built-in ones.
Clicking anything lands on a detail page for that node, which is shaped by what
the node is: producers and consumers for a topic, owner/writers/readers for a
database, every binding version for a contract — and, on all of them, the
business processes that run through it.

### Two detail levels

The map opens at **Services**: every service, with one line per pair for each
kind of relationship between them — an event through a Kafka topic, a call
through an endpoint, a shared database or cache. The topics and stores
themselves are collapsed into the line they carry, so ten services read as ten
services rather than as forty boxes. Click a line and it says what it runs
through, with a link to each one.

**Everything** puts them back: the scan exactly as it was stored.

The collapse is derived for display and never written down — service → service
is an inference from two scanned facts, not a fact the scan found — so nothing
counted, searched or checked for drift is affected by which level you are
looking at.

The key doubles as a set of switches: turn off shared stores, or databases, or
a whole team, and the map redraws without them. It can also be shut away
entirely. Nodes drag, snap to a grid and stay where you put them — per map and
per detail level, with a `Reset layout` to hand it back to the layout engine.

### A process on the map

Pick a process in the filter row and the map draws only that process: every
service, endpoint, cache and topic it runs through, across every repository.
A process also renders as a diagram generated from its own parts — five of
them, because the children are the flow and that one fact makes every view work
at any level:

| | What it answers |
|---|---|
| **Sequence** | what talks to what, in order |
| **Flow** | what happens, what decides it, and where it stops |
| **Lanes** | where the work crosses a team boundary |
| **Handoffs** | who picks it up, and over which topic |
| **Decomposition** | what the process is made of, all the way down |

Only the ones with something to draw are offered: a level 3 decomposes into
nothing, and a stage one team does all of has one lane. This is where the
project started — hand-drawn mermaid process diagrams — except now they are
generated from data that is checked against the code, and a branch to a process
nobody has written is drawn as the dead end it is.

A process can say where the flow goes when it is not simply the next number —
`next: [{"when": "the balance does not cover it", "end": "Order rejected"}]` —
which is what turns the flowchart from a straight line into a process. Leave it
out and the numbering decides, exactly as it always has.

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

## Teams

A team is an attribute of the things on the map, never a member of it: the
estate holds facts found in code, and who is accountable for a service is an
org fact. Teams come from two places — `service.team` in a manifest and `owner`
on a process — and `teams.json` is what turns those strings into an
organisation, giving each team a canonical id, a display name and a department.
The app works without it and says so.

**The registry is editable from the Teams page.** A scan derives a team from
whatever is in the commit history, so an estate typically arrives with teams
named after people and the same team spelt four ways. Renaming one moves it to
the id its new name implies and keeps the old spelling as an alias; merging two
records the loser's id as an alias of the survivor. Either way nothing is
rewritten — the manifests still say what the scan found, the registry says what
that meant, and deleting the alias undoes it. The edits land in `teams.json`, a
plain file you can diff, commit and hand-edit; anything in it the editor does
not recognise is carried through untouched.

**A service's team can be corrected too**, on the node page or in bulk on the
Teams page. That is an `overrides` row, which ingest never reads or writes, so a
re-scan cannot undo it — the same separation that lets a description survive.

## Mapping your own estate

Start at **[`prompts/standalone/`](prompts/standalone/)** — two prompts with
their schemas and a worked example of each, self-contained. Hand one to Claude
inside a repository and it produces the JSON this app ingests; nothing has to be
running first, which matters because you need manifests before the map is useful
and the prompt that makes them would otherwise be locked inside it.

Those files are generated by `npm run prompts` from `prompts/` and `schema/`,
and `npm run verify` fails if a schema is edited without rebuilding them — a
copy of a schema that has quietly drifted is exactly the sort of thing this
project exists to catch.

Once the app is running it renders the same prompts with your estate filled in,
which is better for authoring a process pack because it carries every component
id:

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
| `prompts/standalone/` | Self-contained prompts, schemas and examples to hand to Claude. Generated |
| `server/scripts/` | `validate.mjs`, `seed-demo.mjs`, `build-prompts.mjs`, `verify.mjs`, `verify-ui.mjs` |
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
