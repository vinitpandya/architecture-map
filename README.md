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

## Status

Being built. [SPEC.md](SPEC.md) is the build specification;
[AGENTS.md](AGENTS.md) is how to work on it. Neither is documentation of a
finished thing yet.

## Quick start

```bash
npm install
npm run seed:demo     # a fictional 10-service estate, so there is something to look at
npm run dev
```

- UI → http://localhost:5173
- API → http://localhost:8787

## How it fits together

**Two layers, kept apart.** *Topology* — services, topics, databases, contracts
and their edges — is derived from manifests and rebuilt on every ingest.
*Processes* — the L1/L2/L3 hierarchy, each step bound to a topology node — is
hand-authored and never touched by a scan. Human corrections live in a third
place, `overrides`, so re-scanning can never eat them. Conflating these is how
architecture diagrams rot.

**Evidence is mandatory.** Every node and edge carries `repo`, `file`, `line`
and the source line itself. That makes a hallucinated fact expensive to produce,
gives every screen a clickable citation, and turns staleness into something the
app can detect rather than something you discover in an incident.

**Ids are wire values, not labels.** A topic's id is the literal topic string; a
contract's is the fully-qualified class name or Avro subject. Two repositories
scanned in separate sessions have to emit the same string for the same thing, or
nothing joins.

**Gaps are findings.** A consumer of a topic nobody produces is not an error to
be smoothed over — it is either a boundary with another team or a dead listener,
and both are worth knowing. The `/drift` page is where the map proves it is
still honest.

## Scanning a repository

The app renders the prompt; a human runs it:

1. Open **Scan**, pick a repo, copy the pass-1 prompt
   ([`prompts/scan-pass1.md`](prompts/scan-pass1.md) with the schema inlined).
2. Run it with Claude inside a checkout of that repository.
3. Drop the resulting JSON in `inbox/` and press **Sweep inbox**.

Validate before ingesting if you want a faster error:

```bash
npm run validate -- inbox/payments-service.json
```

Nothing about the app depends on *how* the JSON arrives, which is deliberate —
running the CLI by hand, shelling out to `claude -p`, or calling the API with
structured outputs are all interchangeable, and the choice can change later
without touching the app.

## Repository layout

| Path | |
|---|---|
| `schema/` | The ingest contract, and a worked example |
| `prompts/` | Scan prompts, versioned — pass 1 per repo, pass 2 across manifests |
| `server/` | Express + SQLite: ingest, link, search, graph queries |
| `web/` | React + Vite: the map, detail pages, search |
| `demo/manifests/` | The fictional estate the app is verified against |
| `inbox/` | Drop manifests here (gitignored) |
| `data/` | `architecture.sqlite` (gitignored) |

Style, shell and design tokens are lifted from the sibling `jira-reports`
project — same sidebar, same palette, same widget grid waiting in the wings.
