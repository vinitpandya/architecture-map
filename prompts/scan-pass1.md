# Scan prompt — pass 1 (single repository)

<!--
  promptVersion: 2026-09-18a

  Rendered by GET /api/prompt?name=scan-pass1&repo=<repo>.
  {{REPO}}   → the repository name
  {{SCHEMA}} → the full contents of schema/manifest.schema.json

  Run this from inside a checkout of the target repository. It sees one repo and
  nothing else — cross-repo reconciliation is pass 2's job.
-->

You are mapping the architecture of a single service repository. Produce one
JSON manifest describing what this service owns and what it talks to.

The repository is `{{REPO}}`. You are at its root.

## Method

Work in this order. Do not skip to reading application code first — the
structured files are faster, more reliable, and they tell you what to look for.

1. **Identity.** Read the build file (`build.gradle.kts`, `pom.xml`,
   `package.json`, `go.mod`, `pyproject.toml`), any Helm chart or
   `deployment.yaml`, and the README. Establish the deployable artifact name —
   that is the service id — the language, and what the service is for.
2. **Declared dependencies.** From the build file, every internal shared
   library and its exact version. Each becomes a `contract` node and a
   `depends.on` edge. The version string matters; copy it verbatim.
3. **Schemas.** Any `.avsc`, `.proto`, `.json` schema or OpenAPI spec in the
   repo. Avro subjects and protobuf messages are `contract` nodes.
4. **Migrations.** `db/migration/`, `liquibase/`, `alembic/`, `migrations/`.
   Their presence means this service **owns** that database (`db.owns`).
5. **Configuration.** `application.yml`, `application.properties`, `.env.example`,
   config maps. Topic names, datasource URLs, Redis config, base URLs of other
   services. This is where most topic strings actually live.
6. **Now the code.** Kafka producers and listeners, HTTP clients and
   controllers, repository and cache classes. Use this pass to resolve the
   constants and indirections you saw in steps 2–5, and to write the
   descriptions.

## Rules

**Cite everything.** Every node and every edge needs at least one `evidence`
entry: a path relative to the repo root, a 1-based line number, and the line
itself copied verbatim and trimmed. If you cannot cite it, you may not assert
it.

**Never guess an identifier.** If a topic name is assembled at runtime, or a
base URL comes from an environment variable with no default in the repo, put it
in `unresolved` with the literal expression you saw. An honest gap is useful; a
plausible invention is worse than useless, because it is indistinguishable from
a real finding and it will silently poison every downstream view.

**Resolve constants to wire values.** `Topics.USER_CREATED` is not an id — find
the constant and use its value, `topic:users.created.v2`. If the constant is
defined outside this repo, that is an `unresolved` entry.

**Ids must be reproducible.** Another agent will scan a different repository in
a separate session with no knowledge of this one, and both of you must produce
the byte-identical string for the same topic, database or class. The id rules in
the schema's `nodeId` description are not stylistic; follow them exactly.

**`from` is always this service.** Never reverse an edge to express direction.
`kind` carries the direction: a `kafka.consume` edge still goes
`from: svc:this-service, to: topic:...`.

**One edge per relationship, not per call site.** Five places that publish to the
same topic are one edge with five evidence entries.

**Fill `contract` on Kafka edges** whenever the payload type is visible at the
call site. That field is what makes version-skew detection work across
services, and it is the most valuable thing in the manifest after the topic
names themselves.

**Descriptions are for humans.** One sentence, in business terms. "Publishes a
settled payment so the ledger can post it", not "sends a message to Kafka". For
the service itself, say what it is responsible for, derived from the README and
the code rather than from the repo name.

**Be conservative with `confidence`.** `high` only when the evidence states it
outright. If you resolved it through a constant or a config default, that is
`medium`. If you are inferring from naming convention, prefer `unresolved` over
a `low`-confidence guess.

## Output

Return **only** a single JSON object conforming to the schema below. No prose
before or after, no markdown fence, no commentary. Set `promptVersion` to
`2026-09-18a` and `producer` to `{"kind": "claude", "model": "<your model id>"}`.
Get `commit` from `git rev-parse --short HEAD`.

Write the result to `<repo>.json` and drop it in the architecture-map `inbox/`.

If the repository builds more than one deployable service, produce one manifest
per service and say so.

### Schema

```json
{{SCHEMA}}
```
