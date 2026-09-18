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
}

/** A title in the reader's terms, or the slug if the kind is new. */
export const driftTitle = (kind: string) => DRIFT_KINDS[kind]?.title ?? kind
