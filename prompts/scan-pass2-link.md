# Scan prompt — pass 2 (link across manifests)

<!--
  promptVersion: 2026-09-18a

  Input: every pass-1 manifest, and NO source code. The manifests are small, so
  all of them fit comfortably in one context even when the repositories would
  not. That is the whole reason this is a separate pass.

  Output: a reconciliation report for a human, NOT a manifest. Pass 2 never
  rewrites manifests automatically.
-->

You are reconciling a set of per-repository architecture manifests into one
estate. You can see every manifest and **no source code**. Do not ask for the
code; if a question cannot be answered from the manifests, that is itself the
finding.

The app already computes the deterministic findings — topics with no producer,
shared databases, contract version skew, ids that normalise identically. Do not
re-derive those. Your job is the part that needs judgement.

## What to look for

**Identifiers that refer to the same thing but do not match.** The app flags
mechanical near-misses (case, separators, version suffixes). You are looking for
the ones it cannot see: `topic:trade.executed.v1` and `topic:orders.matched.v1`
may well be the same event under two names, and only the descriptions and
contracts reveal it. For each, give both ids, your reasoning, which you believe
is canonical, and how sure you are.

**Contracts that are really the same contract.** A class in one repo and an Avro
subject in another describing the same payload should be linked. Say which
should be the canonical id.

**Endpoints that do not meet.** A `http.call` to an endpoint nobody exposes,
where some other service exposes something suspiciously similar — usually a path
template normalised differently, or a version prefix present on one side only.

**Unresolved entries you can now resolve.** A topic that repo A could not
resolve may be produced by repo B under a literal name. Match them up on
description, contract and naming.

**Asymmetries worth a human's attention.** A service that consumes an event
whose producer describes it as meaning something different. A contract bound by
one service and nobody else. A database owned by a service that never reads it.

## Rules

**Propose, never merge.** Your output is a report a human acts on. Renaming an
id silently is exactly the failure this whole design exists to prevent.

**Say how confident you are, and why.** "Both carry
`com.meridian.events.OrderMatched` and no other topic does" is a reason.
"The names look similar" is not.

**Distinguish absent from broken.** A topic with no producer among these
manifests is usually owned by a team outside the scanned set — that is normal
and should be reported as an external boundary, not a bug. Only call something
broken when the manifests actually contradict each other.

**Omit what you cannot support.** A short report of real findings beats a long
one padded with speculation.

## Output

Markdown, for a human to read. Group by finding type. For each finding: the ids
involved, the evidence from the manifests that led you there, what you propose,
and your confidence. Finish with a short list of what you checked and found
clean, so the reader knows what the silence covers.

## Manifests

{{MANIFESTS}}
