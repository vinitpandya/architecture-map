# Authoring prompt — process pack

<!--
  promptVersion: 2026-09-24a

  Rendered by GET /api/prompt?name=author-processes&pack=<pack>&team=<team>.
  {{SCHEMA}}     → schema/process-pack.schema.json
  {{PACK}}       → the pack id being authored
  {{BOUNDARY}}   → what the component list below was narrowed to, and by what
  {{COMPONENTS}} → the components inside that boundary, id and name, by kind
  {{PROCESSES}}  → the codes THIS pack already uses, so a re-author keeps them

  Run this with whatever source material describes the processes — a Confluence
  export, a mermaid diagram, a runbook, an interview transcript, or the service
  repositories themselves.
-->

You are turning what a team knows about its business processes into a structured
process pack: the L1/L2/L3 hierarchy, and the component each process uses.

You are authoring the pack `{{PACK}}`.

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
3. **Number them, starting at 1.** The numbering is this pack's own. Another
   team documenting their processes will also have an L1, and neither of you is
   wrong — a code is read as `{{PACK}} L2.1.1`, and the pack is half of it. So
   do **not** try to fit around anybody else's numbers. Use the source
   material's numbering if it has one, since people already cite it; otherwise
   number in the order things happen. If this pack has been authored before,
   its codes are listed below and you keep them. Write them as `L2.1.1` or
   `2.1.1`; both are read the same way.
4. **Say what the pack covers.** Fill `covers` at the top: the owning `team`,
   and the `services` this pack documents — the ones that team runs, not every
   service its processes touch. It is what tells the next author which
   components are theirs, and what makes a step that reaches outside read as a
   handoff rather than as an ordinary step.
5. **Bind the level 3s.** `node` is the component the work happens at, usually
   the service doing it. `interaction` is the relationship it travels over —
   a publish, a consume, an HTTP call, a database or cache access. Take both
   from the component list below. Most level 3s have exactly one of each.

   `node` should normally be inside the boundary — it is where *your* work
   happens. `interaction` routinely leaves it, and should: a publish another
   team consumes, a call into their endpoint. That is the crossing, and it is
   the most valuable thing in the pack.
6. **Leave the higher levels unbound.** A level 1 or 2 rarely names a component
   of its own; its component list is derived by rolling its children up. Do not
   pick its "main" child's component and copy it upward.
7. **Mark the branches.** Where the flow does something other than continue at
   the next number — a decision with two outcomes, an error path that skips
   ahead, a retry that goes back, a step that stops the process — write `next`.
   Leave it out everywhere else; fall-through in numbering order is the default
   and almost every step takes it. See below.
8. **Attribute it.** Fill `source` with where the knowledge came from and, if
   you can tell, who last confirmed it.

## Branches: where the flow does not just continue

The numbering is the order, so a step with no `next` continues at the next
sibling. That is right for most of a process and wrong for the interesting
parts, which is what `next` is for.

```json
{ "code": "2.1.3", "name": "Check the customer may trade",
  "next": [
    { "when": "the customer may trade", "process": "2.1.4" },
    { "when": "they may not", "end": "Estimate refused" }
  ] }
```

- **Two or more entries is a decision.** The `when` is drawn on the arrow, so
  write it as a condition in the reader's words — *the cache has expired*, *the
  balance does not cover it* — not as a variable name.
- **`end` stops the process** on that arm, with the outcome as its label.
  *Order rejected*, *Escalated to an operator*.
- **`process` continues somewhere.** Usually a sibling. It may be any code: an
  error path out of the stage, or one written earlier in the list, which is how
  a retry loop is written.
- A `process` code nobody has written is reported as a finding, never rejected.
  Say what you know.
- **Do not write a `next` that only restates the numbering.** `2.1.1 → 2.1.2`
  with no condition is what already happens, and writing it out turns a clean
  document into a maintenance burden the first time anybody renumbers.
- Branches belong on the step whose outcome decides them, which is normally a
  level 3. Do not restate a child's branch on its parent.

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
reviewable by someone who was not in the room. They are also drawn as the first
and last shape of the flowchart, so keep them to one line.

**Do not pad.** A level 3 with nothing worth saying beyond its name should have
no description at all. Filler makes a document look thorough and read as noise.

## Rules

- `from` in an `interaction` is **always the service**, never the other end;
  `kind` carries the direction. A process where a service consumes an event is
  still `from` the service `to` the topic.
- Three levels, no more. `2.1.1.4` is not a code.
- Codes are permanent, and they are this pack's. Pick the number and keep it.
- A bare code in `handsOffTo` or `next` means **this pack**. To point at another
  team's process, write `<pack>#<code>` — `order-and-execution#2.4.2`. A bare
  code cannot reach outside this pack, and writing one that looks like
  somebody else's number will silently mean your own.
- Flat list. The hierarchy lives in the codes — do not nest processes inside
  each other.
- One pack, one domain — the one `covers` names. Do not reach into another
  team's processes to make yours look complete: name the handoff and stop
  there. Their pack is theirs to write, and a `handsOffTo` pointing at a pack
  nobody has written yet is reported as a finding rather than an error, which
  is exactly the right outcome.
- When the source material is ambiguous about whether two things are one process
  or two, prefer one. Splitting is cheap later; merging is not, because the codes
  are already in tickets by then.
- When you genuinely do not know, leave the field out. An absent description is
  honest; an invented one is not, and it is indistinguishable from a real one.

## Output

Return **only** a single JSON object conforming to the schema below. No prose
before or after, no markdown fence. Set `promptVersion` to `2026-09-24a` and
`producer` to `{"kind": "claude", "model": "<your model id>"}`.

Write it to `<pack>.json` and drop it in the architecture-map `inbox/`.

Then, separately from the JSON, tell the person who asked: which processes you
were least confident about, which components you referenced that were not in the
list, and what the source material did not cover. That note is not part of the
pack — it is what they need in order to review it.

### What this pack covers

{{BOUNDARY}}

### Components in the map

{{COMPONENTS}}

### Codes `{{PACK}}` already uses

Only this pack's. Another pack's numbering is not yours to avoid — if this
section is empty, start at L1.

{{PROCESSES}}

### Schema

```json
{{SCHEMA}}
```
