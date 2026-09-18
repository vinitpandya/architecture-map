#!/usr/bin/env node
/**
 * Generates the Meridian demo estate (SPEC.md §12) as ten manifests in
 * demo/manifests/, then ingests them through the real POST /api/ingest path.
 *
 * NOT WRITTEN YET — this is SPEC.md Phase 3. It matters more than it looks:
 * the real service repositories are not available to the build, so this demo
 * estate is the only way the ingest, link, drift and map layers get verified
 * end to end. Build it from the tables in SPEC.md §12 exactly — the
 * verification numbers in §14 are derived from them.
 */
console.error(
  [
    'seed:demo is not implemented yet — see SPEC.md §12 (the estate) and Phase 3.',
    '',
    'It must:',
    '  1. write ten schema-valid manifests to demo/manifests/',
    '  2. ingest them via the real ingest path, not direct table writes',
    '  3. support --remove to clear them again',
  ].join('\n')
)
process.exit(1)
