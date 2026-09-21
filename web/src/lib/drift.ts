/**
 * What each kind of finding means, in the terms someone reading it at 9am
 * needs. A finding nobody can act on is noise, and noise is how a map stops
 * being opened.
 *
 * Shared rather than private to the drift widget, because the process page
 * lists the same findings and used to print the bare `kind` slug beside them.
 */
export type DriftKind = { title: string; why: string }

export const DRIFT_KINDS: Record<string, DriftKind> = {
  'no-producer': {
    title: 'Topics with no producer',
    why: 'Something is listening to a topic nothing in the scanned set writes. Either it crosses a team boundary, or the listener is dead.',
  },
  'no-consumer': {
    title: 'Topics with no consumer',
    why: 'Published, and nothing in the scanned set reads it.',
  },
  'version-skew': {
    title: 'Contracts bound at more than one version',
    why: 'One payload, several versions in production. The oldest binding is what constrains any change to it.',
  },
  'shared-database': {
    title: 'Databases more than one service writes',
    why: 'Every change to that schema is now a cross-team change, whether or not anyone has noticed.',
  },
  'multiple-owners': {
    title: 'Contested ownership',
    why: 'Two repositories claim the same thing. One of them is wrong.',
  },
  'near-miss': {
    title: 'Ids that might be the same thing',
    why: 'Two ids that normalise identically. Probably one thing spelt twice — a human decides, never the ingest.',
  },
  'orphan-endpoint': {
    title: 'Endpoints nobody serves',
    why: 'A route somebody calls that nothing in the scanned set exposes.',
  },
  'stale-evidence': {
    title: 'Citations that no longer match',
    why: 'The line a fact was read from has changed since the scan.',
  },

  /* Layer B. These are the cross-check the process layer exists for, so they
     are the last findings that should arrive as a bare slug with no
     explanation — which is what they did. */
  'process-missing-component': {
    title: 'Processes naming a component that is gone',
    why: 'A document says a process runs through something no scan has ever found. Either the scan missed it, or the component is gone and the document did not follow.',
  },
  'process-missing-interaction': {
    title: 'Calls a document describes and no code makes',
    why: 'Both ends are real components; the relationship between them is in no scanned repository. Either the scan missed it, or this stopped being true. The most interesting finding in the tool.',
  },
  'process-orphan-code': {
    title: 'Processes whose parent was never written',
    why: 'A code like 3.4.1 with no 3.4 above it. The hierarchy has a hole, so the part is real but nothing places it.',
  },
  'process-duplicate-code': {
    title: 'One code claimed by more than one pack',
    why: 'A code identifies a process, so two packs declaring it means one process cannot hold both. One of the packs is wrong about what that number means.',
  },
  'process-no-detail': {
    title: 'Atomic actions that name nothing',
    why: 'A leaf with no component and no interaction — nothing underneath it and nothing to check it against. It is prose, not a fact about the estate.',
  },
  'uncovered-component': {
    title: 'Components no documented process touches',
    why: 'Something is running that nobody has written down a reason for. Either a process is missing from the documents, or the component is.',
  },
  'process-flow-unknown-target': {
    title: 'Branches that lead nowhere',
    why: 'A step says the flow continues at a code nobody has written. Usually a renumbering that a branch did not follow, and it fails quietly — the flowchart simply stops drawing that arm.',
  },

  /* Layer C. Every one of these arrived as a bare slug: the Health page and
     the process page both read this table, and neither had a sentence for a
     team finding. */
  'unknown-team': {
    title: 'Teams the registry does not have',
    why: 'A manifest or a pack names a team that is not in teams.json. Either it was renamed or merged and the documents have not followed, or the registry is behind. Rename or merge it on the Teams page.',
  },
  'component-no-team': {
    title: 'Services nobody is accountable for',
    why: 'A service whose manifest names no team, so everything it owns is teamless too. Set one on the service page or in the services grid on the Teams page.',
  },
  'multi-team-topic': {
    title: 'Topics more than one team publishes',
    why: 'Fan-in is not a defect, but it means the topic has no single owner — so it is drawn teamless rather than attributed to whichever repo happened to be scanned first.',
  },
  'process-no-owner': {
    title: 'Processes with no owner of their own',
    why: 'A level 1 or 2 whose document names no accountable team. It inherits one for display, but nobody has actually said whose it is.',
  },
  'process-link-unknown-target': {
    title: 'Handoffs to a process nobody wrote',
    why: 'A pack says it hands off to a code no pack declares. Often the honest answer — the team at the other end has not written theirs yet — and worth knowing either way.',
  },
  'process-link-unsupported': {
    title: 'Handoffs nothing in the code backs up',
    why: 'A declared handoff whose two processes do not even share a component. Either it happens outside the code entirely — a file drop, a person — or it stopped happening.',
  },
  'process-link-undocumented': {
    title: 'Handoffs the code makes and no document mentions',
    why: 'One team publishes and another consumes, and neither pack says so. This is the cross-team dependency nobody knows they have.',
  },
}

/** A title in the reader's terms, or the slug if the kind is new. */
export const driftTitle = (kind: string) => DRIFT_KINDS[kind]?.title ?? kind
