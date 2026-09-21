> **This is a standalone copy.** Everything it needs is in this file — you do
> not need the Architecture Map app running to use it. Paste it to Claude (or
> any capable model) from inside the repository you want mapped, or attach it
> along with the schema and example beside it in this folder.
>
> Generated from `prompts/` by `npm run prompts`. Do not edit it here; edit the
> template and rebuild, or your change will be overwritten.

# Scan prompt — pass 1 (single repository)

You are mapping the architecture of a single service repository. Produce one
JSON manifest describing what this service owns and what it talks to.

You are at the root of the repository to be mapped. Take its name from
`git remote get-url origin`, or from the directory — that name becomes `repo`
in the output, and every id you mint has to be reproducible from it.

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

Write the result to `<repo>.json`. If you have the Architecture Map checked
out, drop it in its `inbox/` and press **Sweep inbox** on the Scan page;
otherwise hand the file to whoever does. You can check it first without the
app running — `npm run validate -- <repo>.json` says exactly which field is
wrong and where.

If the repository builds more than one deployable service, produce one manifest
per service and say so.

### Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://bitpanda.internal/architecture-map/manifest.schema.json",
  "title": "Service scan manifest",
  "description": "One manifest per repository, produced by a pass-1 scan. Describes the topology this service participates in: what it owns, what it talks to, and the evidence in the source for every claim. Every fact MUST cite a file and line in this repository. If you cannot cite it, put it in `unresolved` instead of guessing.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "repo", "commit", "scannedAt", "producer", "service", "nodes", "edges", "unresolved"],

  "properties": {
    "schemaVersion": {
      "const": 1,
      "description": "Version of this schema. Always 1."
    },
    "promptVersion": {
      "type": "string",
      "description": "Version of the scan prompt that produced this manifest, e.g. '2026-09-18a'. Copy it verbatim from the prompt.",
      "maxLength": 40
    },
    "repo": {
      "type": "string",
      "description": "Repository name as it appears in the repo list, e.g. 'payments-service'.",
      "pattern": "^[a-z0-9][a-z0-9._-]*$"
    },
    "commit": {
      "type": "string",
      "description": "Full or short SHA of the commit that was scanned.",
      "pattern": "^[0-9a-f]{7,40}$"
    },
    "branch": {
      "type": "string",
      "description": "Branch the commit was taken from, if known."
    },
    "scannedAt": {
      "type": "string",
      "format": "date-time",
      "description": "UTC timestamp when the scan ran, ISO 8601."
    },
    "producer": {
      "type": "object",
      "description": "What generated this manifest. Ingest uses this to decide trust and precedence.",
      "additionalProperties": false,
      "required": ["kind"],
      "properties": {
        "kind": {
          "enum": ["claude", "parser", "human"],
          "description": "'claude' for an LLM scan, 'parser' for the deterministic extractor, 'human' for a hand-written manifest."
        },
        "model": { "type": "string", "description": "Model id, when kind is 'claude'." },
        "tool": { "type": "string", "description": "Tool and version, when kind is 'parser'." },
        "author": { "type": "string", "description": "Who wrote it, when kind is 'human'." }
      }
    },

    "service": {
      "type": "object",
      "description": "The service this repository builds. Exactly one per manifest. If a repo builds several deployable services, emit one manifest per service.",
      "additionalProperties": false,
      "required": ["id", "name"],
      "properties": {
        "id": {
          "$ref": "#/$defs/nodeId",
          "description": "Always 'svc:<deployable artifact name>' - the name it deploys under, not a human label. Lowercase."
        },
        "name": { "type": "string", "description": "Human-readable name, e.g. 'Payments Service'." },
        "language": {
          "type": "string",
          "description": "Primary language, lowercase: kotlin, java, typescript, python, go."
        },
        "team": { "type": "string", "description": "Owning team, if discoverable from CODEOWNERS or similar." },
        "description": {
          "type": "string",
          "description": "One or two sentences on what this service is responsible for, in plain language. Derive it from the README and the code, not from the repo name.",
          "maxLength": 600
        },
        "tags": {
          "type": "array",
          "description": "Free-form labels, e.g. 'pci', 'public-facing'.",
          "items": { "type": "string" }
        }
      }
    },

    "nodes": {
      "type": "array",
      "description": "Everything OTHER than this service that it touches: topics, databases, caches, endpoints, contracts, and external systems. Do not repeat the service itself here. Other Bitpanda services referenced by this one DO belong here, with kind 'service' and only the fields you can evidence.",
      "items": { "$ref": "#/$defs/node" }
    },

    "edges": {
      "type": "array",
      "description": "What this service does to those nodes. `from` is ALWAYS this service's id - never reverse it to express direction; the `kind` carries the direction. One edge per distinct relationship; do not emit one edge per call site, collect the call sites as multiple evidence entries on a single edge.",
      "items": { "$ref": "#/$defs/edge" }
    },

    "unresolved": {
      "type": "array",
      "description": "Things you could see were happening but could not pin down - a topic name built at runtime, a base URL from an env var you could not trace, a client whose target you could not identify. This is a first-class result, not a failure. Never invent a value to avoid using this list.",
      "items": { "$ref": "#/$defs/unresolved" }
    }
  },

  "$defs": {
    "nodeId": {
      "type": "string",
      "description": "A globally unique id, '<prefix>:<value>'. The value is ALWAYS the wire value, never a human label, because another repo scanned in a separate session must produce a byte-identical string for the same thing. svc:<artifact-name> | topic:<literal topic string, resolved through constants> | db:<engine>/<database-name> | cache:<engine>/<logical-name> | api:<svc-name>/<METHOD> <path template with {} placeholders> | contract:<fully.qualified.ClassName> or contract:<avro-subject> | ext:<vendor-name>. Lowercase everything except class names and topic strings, which keep their exact casing.",
      "pattern": "^(svc|topic|db|cache|api|contract|ext):\\S.*$",
      "maxLength": 300
    },

    "evidence": {
      "type": "object",
      "description": "Where in this repository the fact is visible. Required on every node and edge.",
      "additionalProperties": false,
      "required": ["file", "line", "snippet"],
      "properties": {
        "file": {
          "type": "string",
          "description": "Path relative to the repository root, forward slashes.",
          "pattern": "^[^/].*$"
        },
        "line": { "type": "integer", "minimum": 1, "description": "1-based line number." },
        "endLine": { "type": "integer", "minimum": 1, "description": "Last line, when the evidence spans a range." },
        "snippet": {
          "type": "string",
          "description": "The line itself, verbatim and trimmed. Must appear in the file at that line - ingest re-checks it, and a snippet that no longer matches marks the fact stale.",
          "maxLength": 400
        }
      }
    },

    "confidence": {
      "enum": ["high", "medium", "low"],
      "description": "'high' - the evidence states it outright (a literal topic string, an explicit migration, a declared dependency). 'medium' - you resolved it through one level of indirection, such as a constant or an injected config value with a visible default. 'low' - you inferred it from naming or convention. Do not emit 'low' for anything you could instead put in `unresolved`."
    },

    "node": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "kind", "name", "evidence"],
      "properties": {
        "id": { "$ref": "#/$defs/nodeId" },
        "kind": {
          "enum": ["service", "kafka.topic", "database", "cache", "endpoint", "contract", "external"],
          "description": "'external' is anything outside the organisation - a payment provider, S3, an exchange API."
        },
        "name": { "type": "string", "description": "Human-readable label for the graph." },
        "description": {
          "type": "string",
          "description": "What this thing is or carries, in one sentence. Most valuable on topics and contracts.",
          "maxLength": 400
        },
        "engine": {
          "type": "string",
          "description": "Only for kind 'database' or 'cache': postgres, mysql, redis, elasticsearch."
        },
        "method": {
          "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
          "description": "Only for kind 'endpoint'."
        },
        "path": {
          "type": "string",
          "description": "Only for kind 'endpoint'. The path template with every path variable normalised to {}, e.g. '/v1/accounts/{}/balance'. Do not keep the parameter name - two repos will spell it differently and the ids must match."
        },
        "contractType": {
          "enum": ["avro", "protobuf", "json-schema", "class", "openapi"],
          "description": "Only for kind 'contract'."
        },
        "version": {
          "type": "string",
          "description": "Only for kind 'contract'. The version this repo binds to, exactly as the build file or schema declares it, e.g. '3.2.0'."
        },
        "evidence": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/evidence" }
        }
      }
    },

    "edge": {
      "type": "object",
      "additionalProperties": false,
      "required": ["from", "to", "kind", "confidence", "evidence"],
      "properties": {
        "from": {
          "$ref": "#/$defs/nodeId",
          "description": "Always this manifest's service id."
        },
        "to": {
          "$ref": "#/$defs/nodeId",
          "description": "The other end. It does not need to appear in `nodes` if it is owned by a different repo - the link pass resolves it."
        },
        "kind": {
          "enum": [
            "kafka.produce", "kafka.consume",
            "db.read", "db.write", "db.owns",
            "cache.read", "cache.write",
            "http.call", "http.expose",
            "depends.on", "topic.schema"
          ],
          "description": "'db.owns' means this repo holds the migrations for that database. 'http.expose' means this service serves that endpoint; 'http.call' means it calls someone else's. 'depends.on' points at a contract and carries the version binding. 'topic.schema' declares which contract a topic carries - emit it from whichever side you can see it."
        },
        "contract": {
          "$ref": "#/$defs/nodeId",
          "description": "Optional contract id for the payload on this edge. On a kafka edge this is the event class or Avro subject, and it is the single most useful field for detecting version skew across services - fill it whenever the type is visible at the call site."
        },
        "description": {
          "type": "string",
          "description": "What this interaction is for, in one sentence, in business terms rather than mechanics. 'Publishes a settled trade so ledger can post it', not 'sends to Kafka'.",
          "maxLength": 400
        },
        "confidence": { "$ref": "#/$defs/confidence" },
        "evidence": {
          "type": "array",
          "minItems": 1,
          "description": "Every call site you found for this relationship, up to a sensible handful.",
          "items": { "$ref": "#/$defs/evidence" }
        }
      }
    },

    "unresolved": {
      "type": "object",
      "additionalProperties": false,
      "required": ["expected", "raw", "reason", "evidence"],
      "properties": {
        "expected": {
          "enum": ["kafka.topic", "database", "cache", "endpoint", "contract", "service", "external"],
          "description": "What kind of thing you believe this is."
        },
        "raw": {
          "type": "string",
          "description": "The literal expression you saw, e.g. 'Topics.USER_CREATED' or '${PRICING_BASE_URL}'."
        },
        "reason": {
          "type": "string",
          "description": "Why you could not resolve it, in one sentence.",
          "maxLength": 300
        },
        "evidence": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/evidence" }
        }
      }
    }
  }
}
```
