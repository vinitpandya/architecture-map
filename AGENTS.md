# Working instructions

You are building the app described in [SPEC.md](SPEC.md). Read it fully before
you start. This file is about *how* to work, not what to build.

If you arrived here first, go to [START-HERE.md](START-HERE.md) instead — it is
the entry point and routes you through everything in order.

## The situation

The author kicked this off and is away. Nobody will answer questions. Your job
is to get as far down §13 Build order as you can, with every phase you claim to
have finished actually verified.

## Rules

**Do not ask questions.** If the spec is silent on something, choose the option
most consistent with the surrounding design, write one line about it in
`DECISIONS.md`, and keep moving. A finished app with six recorded judgement
calls is worth far more than a half-built one with six questions attached.

**Do not expand scope.** SPEC.md §1 lists what is explicitly out of scope.
Process flows, widgets, dashboards, AI search and auth are all *deliberately*
excluded from v1. Building them is not a bonus; it is a defect.

**Verify before you claim.** Every phase in §13 has verification steps in §14.
Run them. If one fails and you cannot fix it, leave it failing, say so in the
handover, and move on to the next phase rather than stopping.

**Commit per phase**, with the phase name in the message. If a phase is large,
commit within it. Never leave the tree broken at a commit.

**Do not touch the design tokens.** `web/src/styles/theme.css` is a validated
palette. Add tokens, never retune existing ones.

**Prefer the existing primitives.** `ui.tsx` already has `Card`, `Modal`,
`Banner`, `Empty`, `StatTile`, `Tooltip`, `Legend`, `useMeasure`,
`useThemeVersion`. `DataGrid.tsx` and `Picker.tsx` are complete. Writing a
second Modal is a sign you did not read them.

**Match the house style.** Read a few files in `reference/jira-reports/` before
writing your first component. Notice: no state library, no CSS-in-JS, plain
`useEffect` + `useState`, sparse comments that explain *why* rather than what,
and inline SVG icons defined at the bottom of the file that uses them. Write
code that looks like it was always there.

## No network beyond npm

You do not have the Bitpanda service repositories and cannot get them. The demo
estate in SPEC.md §12 exists precisely so the whole system can be built and
verified without them. Do not attempt to clone anything, do not stub the
scanner against imaginary real repos, and do not weaken a test because real data
is unavailable.

## The shell is already built

Do not rebuild it. `npm install && npm run dev` gives you a running app: the
sidebar, five seeded pages, addable and draggable custom pages, the widget grid
with add/configure/resize/full-screen, the filter row, search, node detail, the
scan page and the ingest log. The widget registry has nine types wired up.

What is missing is the business logic those screens read from. Every screen is
already pointed at a real endpoint running a real query — they render empty
states because nothing has been ingested yet. Finish Phase 1 and most of the
app lights up at once.

So: **add a widget by adding a `WidgetDef` and a `WidgetBody` case**, not by
inventing a new rendering path. Add an endpoint beside the existing ones in
`routes.js`. If you find yourself writing a second Modal, a second table or a
second fetch hook, stop and go find the one that already exists.

## If you run short of time

The build order is arranged so stopping early still leaves something useful:

- After **Phase 3** the app is fully demonstrable on the demo estate — every
  page populated, only search results and the map still missing.
- **Phase 5** (the map) is the headline feature and also the one with the most
  unknowns. Do not start it on a broken Phase 3.

A missing map is a known gap. A half-working everything is not.

## Handover

When you stop, for any reason, write `HANDOVER.md` at the repo root:

1. Which phases are complete and verified, and which verification steps you
   actually ran.
2. Anything failing, with the error and what you tried.
3. Every judgement call from `DECISIONS.md`, one line each.
4. The exact commands to run the thing.
5. What you would do next, in priority order.

Be accurate rather than encouraging. If the graph does not lay out properly,
say the graph does not lay out properly. The author will read this before
touching the code and would much rather know.
