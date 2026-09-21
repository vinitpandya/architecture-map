> **This is a standalone copy.** Everything it needs is in this file — you do
> not need the Architecture Map app running to use it. Paste it to Claude (or
> any capable model) from inside the repository you want mapped, or attach it
> along with the schema and example beside it in this folder.
>
> Generated from `prompts/` by `npm run prompts`. Do not edit it here; edit the
> template and rebuild, or your change will be overwritten.

# Authoring prompt — process pack

You are turning what a team knows about its business processes into a structured
process pack: the L1/L2/L3 hierarchy, and the component each process uses.

You are authoring the pack `<pack-id>`.

## The one thing to get right

**The levels are decomposition, not sequence.** Each level says the same thing
in more detail. It is not a call stack and it is not a list of hops.

```
L2      Order and execution                      what the business does
L2.1      Getting estimate                       a stage of it
L2.1.1      Take the quote from the cache        the atomic action
L2.1.2      Get prices from the pricing service
L2.1.3      Check the customer may trade
L2.2      Accepting estimate and placing order
L2.2.1      Receive the accepted order
L2.2.2      Persist the order
```

So a **level 3 is already the atomic unit of work**. There is no step list
underneath it — "Get prices from the pricing service" *is* the leaf. If
something needs breaking down further, it becomes siblings at the same level,
never a nested list inside one.

**Order comes from the numbering.** `2.1` happens before `2.2`; `2.1.1` before
`2.1.2`. There is no sequence field, because the code already carries it.

## What you are not doing

You are **not** discovering architecture. The components already exist — they
were found by scanning the repositories, with a file and line behind each one,
and they are listed below. Your job is to describe what the business does and
attach it to those components.

So: **never invent a component.** If a process clearly uses something that is
not in the list, reference it with the id you believe it should have and move
on. The app reports that as a finding, and that finding is valuable — it means
either the scan missed something or the process document is out of date. Quietly
substituting a component that *does* exist, because it looked close enough,
destroys exactly the signal the tool is built to produce.

## Method

1. **Read the source material first, all of it**, before writing any JSON. You
   are looking for the shape of the hierarchy, not yet the detail.
2. **Establish the levels.** Level 1 is an outcome the business or the customer
   cares about — *Order and execution*, *Onboarding and funding*. Level 2 is a
   stage within it — *Getting estimate*, *Accepting estimate and placing order*.
   Level 3 is one thing that happens — *Get prices from the pricing service*.
3. **Number them.** Use the existing numbering if the source material has one —
   people already cite those numbers. Otherwise number in the order things
   happen, and check against the codes already loaded, below, so you do not
   collide with another pack. Write them as `L2.1.1` or `2.1.1`; both are read
   the same way.
4. **Bind the level 3s.** `node` is the component the work happens at, usually
   the service doing it. `interaction` is the relationship it travels over —
   a publish, a consume, an HTTP call, a database or cache access. Take both
   from the component list below. Most level 3s have exactly one of each.
5. **Leave the higher levels unbound.** A level 1 or 2 rarely names a component
   of its own; its component list is derived by rolling its children up. Do not
   pick its "main" child's component and copy it upward.
6. **Attribute it.** Fill `source` with where the knowledge came from and, if
   you can tell, who last confirmed it.

## Writing the descriptions

This is most of the value, and the part a person cannot get from the code.

**Describe the business, not the plumbing.** "Reads the KYC state, so a customer
who has not passed verification is refused before they accept rather than after"
— not "calls identity-service". The mechanics are already in the map; the reason
is not.

**Say what a newcomer would get wrong.** Retries, idempotency, what happens on
failure, which parts are best-effort, where responsibility actually changes
hands. If a redelivered event would double-post without a guard, say so — that
sentence is worth the whole document.

**At level 1, describe the outcome.** At level 3, describe the work. Never
restate the title in the description.

**Fill `trigger` and `outcome`** where they are not obvious from the parent —
usually at levels 1 and 2. They are short, and they are what make a process
reviewable by someone who was not in the room.

**Do not pad.** A level 3 with nothing worth saying beyond its name should have
no description at all. Filler makes a document look thorough and read as noise.

## Rules

- `from` in an `interaction` is **always the service**, never the other end;
  `kind` carries the direction. A process where a service consumes an event is
  still `from` the service `to` the topic.
- Three levels, no more. `2.1.1.4` is not a code.
- Codes are permanent. Pick the number and keep it.
- Flat list. The hierarchy lives in the codes — do not nest processes inside
  each other.
- One pack, one domain. Do not reach into another team's processes to make yours
  look complete.
- When the source material is ambiguous about whether two things are one process
  or two, prefer one. Splitting is cheap later; merging is not, because the codes
  are already in tickets by then.
- When you genuinely do not know, leave the field out. An absent description is
  honest; an invented one is not, and it is indistinguishable from a real one.

## Output

Return **only** a single JSON object conforming to the schema below. No prose
before or after, no markdown fence. Set `promptVersion` to `2026-09-18b` and
`producer` to `{"kind": "claude", "model": "<your model id>"}`.

Write it to `<pack>.json`. Drop it in the Architecture Map’s `inbox/` and
press **Sweep inbox**, or check it first with
`npm run validate -- <pack>.json`, which routes on the shape and tells you
which schema it picked.

Then, separately from the JSON, tell the person who asked: which processes you
were least confident about, which components you referenced that were not in the
list, and what the source material did not cover. That note is not part of the
pack — it is what they need in order to review it.

### Components in the map

_Paste the component list here before running this prompt._

This is the one thing a standalone copy cannot carry, because it is a fact
about **your** estate rather than about the schema. Three ways to get it,
best first:

1. **From the running app.** The Scan page’s *Processes* tab renders this
   same prompt with every component id already in it. Copy that instead of
   this file and you can skip this section entirely.
2. **From the API.** `curl localhost:8787/api/nodes?limit=500` and paste the
   ids and names.
3. **From the manifests.** If nothing is ingested yet, paste the scan
   manifests themselves — every `id` in them is a component.

If you genuinely have none of these, say so and work from the source material
alone: reference components with the ids you believe they should have, and
flag every one of them. An unresolved reference is reported as a finding,
which is useful. A quietly substituted one is not.

### Codes already in use

_Paste the codes already in use here, if any._

`curl localhost:8787/api/processes` lists them, or read the packs already in
`demo/processes/`. Codes are permanent and unique across every pack, so two
packs claiming one number is a reported conflict — pick a level 1 number
nobody has taken.

### Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://bitpanda.internal/architecture-map/process-pack.schema.json",
  "title": "Process pack",
  "description": "A set of business processes — the L1/L2/L3 hierarchy — and the components each one uses. The levels are DECOMPOSITION, not sequence: each level says the same thing in more detail, so L1.1.1 is a more granular description of part of L1.1, not a hop within it. A level 3 is therefore already the atomic unit of work ('Get prices from the pricing service'), and there is no step list beneath it — if something needs breaking down further, it is a sibling at the same level. Order comes from the numbering: 1.1 happens before 1.2. Unlike a scan manifest, which is derived from code and covers one repository, a pack is authored by people and spans every repository its processes run through. A pack NEVER creates a component: it only references components a scan already established, and a reference that does not resolve is reported as a finding, because it means either the scan missed something or this document is stale.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "pack",
    "name",
    "authoredAt",
    "producer",
    "processes"
  ],
  "properties": {
    "schemaVersion": {
      "const": 1,
      "description": "Version of this schema. Always 1."
    },
    "promptVersion": {
      "type": "string",
      "description": "Version of the authoring prompt that produced this pack, when one did. Copy it verbatim from the prompt.",
      "maxLength": 40
    },
    "pack": {
      "type": "string",
      "description": "Stable id for this pack, lowercase. The unit of re-ingest: loading a pack replaces every process it previously contributed and touches nothing else. Split packs by domain or owning team, e.g. 'order-and-execution', 'onboarding'.",
      "pattern": "^[a-z0-9][a-z0-9._-]*$",
      "maxLength": 80
    },
    "name": {
      "type": "string",
      "description": "Human-readable name for the pack, e.g. 'Order and execution'."
    },
    "description": {
      "type": "string",
      "description": "What this pack covers, and just as usefully what it does not.",
      "maxLength": 800
    },
    "authoredAt": {
      "type": "string",
      "format": "date-time",
      "description": "UTC timestamp when the pack was written or last revised, ISO 8601."
    },
    "producer": {
      "type": "object",
      "description": "Who or what wrote this pack. Ingest uses it to decide trust and precedence.",
      "additionalProperties": false,
      "required": [
        "kind"
      ],
      "properties": {
        "kind": {
          "enum": [
            "human",
            "claude",
            "import"
          ],
          "description": "'human' for hand-authored, 'claude' for an LLM draft, 'import' for a conversion from an existing document such as a Confluence page or a mermaid diagram."
        },
        "model": {
          "type": "string",
          "description": "Model id, when kind is 'claude'."
        },
        "author": {
          "type": "string",
          "description": "Who wrote or approved it."
        },
        "tool": {
          "type": "string",
          "description": "Converter and version, when kind is 'import'."
        }
      }
    },
    "source": {
      "$ref": "#/$defs/source",
      "description": "Default provenance for every process in the pack. A process may override it with its own `source`."
    },
    "processes": {
      "type": "array",
      "description": "Every process in the pack, as a FLAT list. The hierarchy is carried by `code`, not by nesting — do not nest children inside parents. Order within the list does not matter; the numbering decides it.",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/process"
      }
    }
  },
  "$defs": {
    "code": {
      "type": "string",
      "description": "The process number as people say it out loud: '1', '1.1', '1.1.1', and written 'L1', 'L1.1', 'L1.1.1' when the level prefix helps. An optional leading 'L' is accepted and stripped, so 'L1.1.1' and '1.1.1' are the same process. The code carries the whole hierarchy: the number of segments is the level, and the parent is the code with its last segment removed, so '1.1.1' is a level 3 whose parent is '1.1'. It also carries the order — 1.1 comes before 1.2 — so siblings need no separate sequence field. Every code except a level 1 must have its parent present somewhere in the estate, in this pack or an already-loaded one. Segments are positive integers with no leading zeros. Codes are stable: people cite them in tickets and documents, so renumbering is a real cost — pick a number and keep it.",
      "pattern": "^[Ll]?[1-9][0-9]*(\\.[1-9][0-9]*){0,2}$",
      "maxLength": 40
    },
    "nodeId": {
      "type": "string",
      "description": "A component id exactly as the topology holds it: 'svc:order-service', 'topic:orders.placed.v1', 'db:postgres/orders', 'cache:redis/session', 'api:pricing-service/GET /v1/rates/{}', 'contract:com.meridian.events.OrderPlaced', 'ext:stripe'. Never invent one — if the component you mean is not in the map, reference it anyway and let the finding surface; do not guess at a different id that happens to exist.",
      "pattern": "^(svc|topic|db|cache|api|contract|ext):\\S.*$",
      "maxLength": 300
    },
    "source": {
      "type": "object",
      "description": "Where this knowledge came from. Process facts are asserted by people, not derived from code, so they carry attribution rather than the file-and-line evidence a scan manifest carries. Do not fabricate a code citation for a process.",
      "additionalProperties": false,
      "properties": {
        "kind": {
          "enum": [
            "confluence",
            "diagram",
            "interview",
            "code",
            "runbook",
            "ticket",
            "other"
          ],
          "description": "What sort of source this is."
        },
        "url": {
          "type": "string",
          "description": "Link to the document, diagram or ticket."
        },
        "title": {
          "type": "string",
          "description": "Its title, so the reference survives a dead link."
        },
        "owner": {
          "type": "string",
          "description": "The person or team who confirmed this is accurate."
        },
        "asOf": {
          "type": "string",
          "description": "When it was last confirmed accurate, YYYY-MM-DD. A process nobody has confirmed in a year is worth knowing about."
        }
      }
    },
    "process": {
      "type": "object",
      "description": "One process at any level. The same shape serves all three: a level 1 is broad and usually names no component of its own, a level 3 is a single granular action and usually names exactly one. Nothing about a level 3 is special in the schema — it is simply a process that nothing decomposes further.",
      "additionalProperties": false,
      "required": [
        "code",
        "name"
      ],
      "properties": {
        "code": {
          "$ref": "#/$defs/code"
        },
        "name": {
          "type": "string",
          "description": "The process title, as a thing that is done: 'Get prices from the pricing service', not 'Pricing service call'. Short enough to read in a tree.",
          "maxLength": 200
        },
        "description": {
          "type": "string",
          "description": "What this process is and when it happens, in plain language a new joiner would understand. At level 1 describe the outcome for the customer or the business; at level 3 describe the actual work, including anything a reader would otherwise get wrong — retries, idempotency, what happens when it fails. Never restate the title.",
          "maxLength": 2000
        },
        "owner": {
          "type": "string",
          "description": "The team accountable for this process."
        },
        "actor": {
          "type": "string",
          "description": "Who performs it, when it is not the service in `node` — a customer, an operator, a scheduled job, an external provider."
        },
        "trigger": {
          "type": "string",
          "description": "What starts it. Most useful at level 1 and 2, where it is not obvious from the parent.",
          "maxLength": 300
        },
        "outcome": {
          "type": "string",
          "description": "What is true once it has finished.",
          "maxLength": 300
        },
        "node": {
          "$ref": "#/$defs/nodeId",
          "description": "The single component this process happens at or to — usually the service doing the work. A level 3 normally has exactly one. Leave it out at higher levels rather than guessing at the most important child's component; the parent's components are derived by rolling its children up."
        },
        "interaction": {
          "$ref": "#/$defs/interaction",
          "description": "The relationship this process travels over, when it crosses a boundary: a Kafka publish or consume, an HTTP call, a database or cache access. A level 3 that talks to something else almost always has one."
        },
        "touches": {
          "type": "array",
          "description": "Any further components this process uses beyond `node` and `interaction` — for a level 3 that genuinely reads two stores, or for a higher level whose children are not written yet. A parent's component list is DERIVED by rolling up its children, so never restate a child's components here.",
          "items": {
            "$ref": "#/$defs/nodeId"
          }
        },
        "handsOffTo": {
          "type": "array",
          "description": "Where this process hands over to another team. Normally written on a level 3, where the handoff actually happens; it rolls up to the levels above automatically, so never restate a child's handoff on its parent.",
          "items": {
            "$ref": "#/$defs/handoff"
          }
        },
        "optional": {
          "type": "boolean",
          "description": "True when this only happens in some cases; say when in `description`. A cache miss fallback is the usual example."
        },
        "tags": {
          "type": "array",
          "description": "Free-form labels, e.g. 'regulated', 'customer-facing'.",
          "items": {
            "type": "string"
          }
        },
        "notes": {
          "type": "string",
          "description": "Anything that does not fit elsewhere: known issues, planned changes, why it is done this odd way.",
          "maxLength": 600
        },
        "source": {
          "$ref": "#/$defs/source"
        }
      }
    },
    "interaction": {
      "type": "object",
      "description": "A relationship in the topology, described the way a person can write it. Ingest resolves it to the edge the scan found, by the same from|kind|to key the scan used — you never write an edge id by hand. `from` is ALWAYS the service, exactly as in a scan manifest; `kind` carries the direction, so a process where a service consumes an event is still from the service to the topic.",
      "additionalProperties": false,
      "required": [
        "from",
        "kind",
        "to"
      ],
      "properties": {
        "from": {
          "$ref": "#/$defs/nodeId",
          "description": "Always the service, never the other end."
        },
        "kind": {
          "enum": [
            "kafka.produce",
            "kafka.consume",
            "db.read",
            "db.write",
            "db.owns",
            "cache.read",
            "cache.write",
            "http.call",
            "http.expose",
            "depends.on",
            "topic.schema"
          ],
          "description": "Same set a scan manifest uses; the two must match exactly or the interaction will not resolve."
        },
        "to": {
          "$ref": "#/$defs/nodeId",
          "description": "The other end: the topic, database, cache, endpoint, contract or external system."
        }
      }
    },
    "handoff": {
      "type": "object",
      "description": "A handoff to another team's process: the point where this process ends and theirs begins. Declare one ONLY where the code cannot show it — a nightly batch, a file drop, a person, a ticket, or an HTTP call whose receiving process you happen to know. A Kafka publish that another process consumes is DERIVED automatically from the topic and needs no declaration, though declaring it anyway is harmless and reads as agreement. Do not declare an ordinary synchronous call: calling an endpoint is a dependency on that team, not a handoff to one of their processes, and the map already shows it through the component you both touch.",
      "additionalProperties": false,
      "required": [
        "process"
      ],
      "properties": {
        "process": {
          "$ref": "#/$defs/code",
          "description": "The code of the process this one hands off to, with or without its 'L'. It may belong to a pack nobody has written yet — that is reported, not rejected, because 'we hand off to a team that is not on the map' is worth knowing."
        },
        "note": {
          "type": "string",
          "description": "Why, in one sentence, and especially HOW when the code cannot show it: 'a nightly export the risk team picks up', 'the operator emails the signed form'. This is the part a derived handoff does not have, and the reason a declaration is worth writing at all.",
          "maxLength": 400
        }
      }
    }
  }
}
```
