# Authoring prompt — process pack

<!--
  promptVersion: 2026-09-18a

  Rendered by GET /api/prompt?name=author-processes&pack=<pack>.
  {{SCHEMA}}     → schema/process-pack.schema.json
  {{PACK}}       → the pack id being authored
  {{COMPONENTS}} → every component currently in the map, id and name, by kind
  {{PROCESSES}}  → the process codes already loaded, so you do not collide

  Run this with whatever source material describes the processes — a Confluence
  export, a mermaid diagram, a runbook, an interview transcript, or the service
  repositories themselves.
-->

You are turning what a team knows about its business processes into a structured
process pack: the L1/L2/L3 hierarchy, and the components each process actually
uses.

You are authoring the pack `{{PACK}}`.

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
   cares about — *Trade*, *Onboard a customer*. Level 2 is a stage within it —
   *Place an order*, *Match and settle*. Level 3 is a unit of work with a
   trigger and an end state — *Validate and price the order*. If a level 2 has
   only one level 3 beneath it, you have probably split something that did not
   need splitting.
3. **Number them.** Use the existing numbering if the source material has one —
   people already cite those numbers. Otherwise assign codes in the order
   processes happen, and check against the codes already loaded, below, so you
   do not collide with another pack.
4. **Write the steps, at the leaves only.** A process with children must not
   have steps; the children are its detail.
5. **Bind each step.** `node` is the component the step happens at, usually the
   service doing the work. `interaction` is the relationship it travels over
   when it crosses a boundary — a publish, a consume, an HTTP call, a database
   write. Take both from the component list.
6. **Attribute it.** Fill `source` with where the knowledge came from and, if
   you can tell, who last confirmed it.

## Writing the descriptions

This is most of the value, and the part a person cannot get from the code.

**Describe the business, not the plumbing.** "Checks the customer may trade and
attaches the rate the order will be matched against" — not "calls identity and
pricing". The mechanics are already in the map; the reason is not.

**Say what a newcomer would get wrong.** Retries, idempotency, what happens on
failure, which steps are best-effort, where the handover of responsibility
actually is. If a redelivered event would double-post without a guard, say so —
that sentence is worth the whole document.

**At level 1, describe the outcome.** At level 3, describe the work. Never
restate the title in the description.

**Fill `trigger` and `outcome` on every leaf.** What starts it, and what is true
once it has finished. They are short, and they are what make a process
reviewable by someone who was not in the room.

**Do not pad.** A step with nothing worth saying beyond its name should have no
description. Filler makes a document look thorough and read as noise.

## Rules

- `from` in an `interaction` is **always the service**, never the other end;
  `kind` carries the direction. A step where a service consumes an event is
  still `from` the service `to` the topic.
- Codes are permanent. Pick the number and keep it.
- Flat list. The hierarchy lives in the codes — do not nest processes inside
  each other.
- One pack, one domain. Do not reach into another team's processes to make yours
  look complete.
- When the source material is ambiguous about whether two things are one process
  or two, prefer one process with two steps. Splitting is cheap later; merging
  is not, because the codes are already in tickets by then.
- When you genuinely do not know, leave the field out. An absent description is
  honest; an invented one is not, and it is indistinguishable from a real one.

## Output

Return **only** a single JSON object conforming to the schema below. No prose
before or after, no markdown fence. Set `promptVersion` to `2026-09-18a` and
`producer` to `{"kind": "claude", "model": "<your model id>"}`.

Write it to `<pack>.json` and drop it in the architecture-map `inbox/`.

Then, separately from the JSON, tell the person who asked: which processes you
were least confident about, which components you referenced that were not in the
list, and what the source material did not cover. That note is not part of the
pack — it is what they need in order to review it.

### Components in the map

{{COMPONENTS}}

### Codes already in use

{{PROCESSES}}

### Schema

```json
{{SCHEMA}}
```
