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

## Quick start

```bash
npm install
npm run seed:demo     # the fictional Meridian estate — ten services
npm run dev
```

- UI → http://localhost:5173
- API → http://localhost:8787

Without the seeder every screen comes up in an empty state, which is correct:
nothing has been ingested. `npm run seed:demo -- --remove` clears it again.

```bash
npm run verify        # SPEC.md §14, as a runnable check
npm run validate -- inbox/payments-service.json
npm run build && npm start   # production build, UI and API on one port
```

## What is here

| Page | |
|---|---|
| **Map** | The estate as a graph. Focus, depth, kinds and repos across the top; a node inspector on the right. Click to select, double-click to re-focus — the back button undoes it. |
| **Estate** | Counts, the service and topic lists, and what has been scanned. |
| **Messaging** | Topics, and producers against consumers for whichever one is in focus. |
| **Contracts** | Who binds which version of what, and where they diverge. |
| **Health** | Drift findings, unresolved references, orphans, quarantined manifests. |
| **Search** | Names, ids, descriptions — and the evidence snippets, so `@KafkaListener` or a table name finds the code. |
| **Scan** | The repository list, the rendered scan prompt to paste into Claude, and the inbox. |
| **Manifests** | The ingest log, including quarantined manifests with their validation errors. |

Every page is a grid of widgets you can add, drag, resize, configure and
full-screen, and you can make your own pages beside the five built-in ones.
Clicking anything lands on a detail page for that node, which is shaped by what
the node is: producers and consumers for a topic, owner/writers/readers for a
database, every binding version for a contract.

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
on every ingest. *Processes* (Layer B) are hand-authored; the tables exist and
nothing reads them in v1. *Overrides* are human corrections applied on read —
ingest never touches them, which is why a re-scan cannot eat somebody's work.

**Gaps are findings.** A consumer of a topic nobody produces is not an error to
be smoothed over — it is either a boundary with another team or a dead listener,
and both are worth knowing. The drift findings are where the map proves it is
still honest.

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

## The demo estate

`demo/manifests/` holds ten committed manifests describing **Meridian**, a
fictional trading platform. It exists because the real service repositories are
not available to the build, and it is what ingest, the link pass, drift
detection and the map are verified against. It deliberately contains a topic
nobody produces, a database two services write, three contracts bound at
different versions, and three references a scan could see but not resolve.

`server/scripts/demo/estate.mjs` is the estate as data; changing it changes what
`npm run verify` asserts.

## Repository layout

| Path | |
|---|---|
| `schema/` | The ingest contract, and a worked example |
| `prompts/` | Scan prompts, versioned — pass 1 per repo, pass 2 across manifests |
| `server/src/` | Express + SQLite: `ingest.js`, `link.js`, `routes.js`, `db.js` |
| `server/scripts/` | `validate.mjs`, `seed-demo.mjs`, `verify.mjs` |
| `web/src/graph/` | The map: React Flow canvas, elk layout, per-kind nodes |
| `web/src/dashboard/` | The widget grid and registry |
| `demo/manifests/` | The fictional estate the app is verified against |
| `inbox/` | Drop manifests here (gitignored) |
| `data/` | `architecture.sqlite` (gitignored) |

[SPEC.md](SPEC.md) is the build specification, [DECISIONS.md](DECISIONS.md)
records the judgement calls made against it, and [HANDOVER.md](HANDOVER.md) says
what is verified and what is not.

## Not in v1

Layer B process flows (the tables exist; no UI, no API), semantic search, any
form of authentication, and any automated invocation of Claude — the app renders
prompts and a human runs them.
