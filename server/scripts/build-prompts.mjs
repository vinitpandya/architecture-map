#!/usr/bin/env node
/**
 * Builds the standalone prompt pack in `prompts/standalone/`.
 *
 *   npm run prompts
 *   npm run prompts -- --check     exit 1 if the committed copies are stale
 *
 * The prompts in `prompts/` are templates: `{{SCHEMA}}` and the rest are filled
 * in by `GET /api/prompt` at request time. That is right for the Scan page and
 * wrong for the thing people actually need first — a file you can hand to
 * Claude inside a repository you have not mapped yet, before this app has
 * anything in it. That is a bootstrap problem: you need manifests before the
 * map is useful, and the prompt that makes manifests was locked inside it.
 *
 * So these are DERIVED, never hand-edited. Editing `prompts/scan-pass1.md`
 * changes both the rendered and the standalone version, and `--check` in the
 * verification run fails if somebody edits a schema and forgets to rebuild.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from '../src/config.js'

const OUT = path.join(ROOT, 'prompts', 'standalone')
const args = process.argv.slice(2)
const check = args.includes('--check')

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

/** The HTML comment at the top documents the placeholders. A standalone copy
 *  has no placeholders, so the legend would be describing nothing. */
const stripHeader = (md) => md.replace(/^<!--[\s\S]*?-->\n+/m, '')

/** Every `{{…}}` replaced through a function, so a `$` in a schema description
 *  is not expanded as a replacement pattern. */
const fill = (md, values) =>
  md.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => (key in values ? values[key] : whole))

const PREAMBLE = `> **This is a standalone copy.** Everything it needs is in this file — you do
> not need the Architecture Map app running to use it. Paste it to Claude (or
> any capable model) from inside the repository you want mapped, or attach it
> along with the schema and example beside it in this folder.
>
> Generated from \`prompts/\` by \`npm run prompts\`. Do not edit it here; edit the
> template and rebuild, or your change will be overwritten.

`

const files = {}

/* ── 1 · scan one repository ─────────────────────────────────────────────── */

files['1-scan-a-repository.md'] =
  PREAMBLE +
  fill(stripHeader(read('prompts', 'scan-pass1.md')), {
    SCHEMA: read('schema', 'manifest.schema.json').trim(),
  })
    // A whole sentence rather than a `{{REPO}}` fill: the template wraps the
    // placeholder in backticks, and a phrase with backticks of its own nests
    // them into broken markdown.
    .replace(
      'The repository is `{{REPO}}`. You are at its root.',
      'You are at the root of the repository to be mapped. Take its name from\n' +
        '`git remote get-url origin`, or from the directory — that name becomes `repo`\n' +
        'in the output, and every id you mint has to be reproducible from it.'
    )
    .replace(
    'Write the result to `<repo>.json` and drop it in the architecture-map `inbox/`.',
    [
      'Write the result to `<repo>.json`. If you have the Architecture Map checked',
      'out, drop it in its `inbox/` and press **Sweep inbox** on the Scan page;',
      'otherwise hand the file to whoever does. You can check it first without the',
      'app running — `npm run validate -- <repo>.json` says exactly which field is',
      'wrong and where.',
    ].join('\n')
  )

/* ── 2 · author a process pack ───────────────────────────────────────────── */

files['2-author-a-process-pack.md'] =
  PREAMBLE +
  fill(stripHeader(read('prompts', 'author-processes.md')), {
    PACK: '<pack-id>',
    SCHEMA: read('schema', 'process-pack.schema.json').trim(),
    COMPONENTS: [
      '_Paste the component list here before running this prompt._',
      '',
      'This is the one thing a standalone copy cannot carry, because it is a fact',
      'about **your** estate rather than about the schema. Three ways to get it,',
      'best first:',
      '',
      '1. **From the running app.** The Scan page’s *Processes* tab renders this',
      '   same prompt with every component id already in it. Copy that instead of',
      '   this file and you can skip this section entirely.',
      '2. **From the API.** `curl localhost:8787/api/nodes?limit=500` and paste the',
      '   ids and names.',
      '3. **From the manifests.** If nothing is ingested yet, paste the scan',
      '   manifests themselves — every `id` in them is a component.',
      '',
      'If you genuinely have none of these, say so and work from the source material',
      'alone: reference components with the ids you believe they should have, and',
      'flag every one of them. An unresolved reference is reported as a finding,',
      'which is useful. A quietly substituted one is not.',
    ].join('\n'),
    PROCESSES: [
      '_Paste this pack’s own codes here, if it has been authored before._',
      '',
      '`curl "localhost:8787/api/processes?pack=<pack-id>"` lists them. Only this',
      'pack’s: a code belongs to the pack that numbered it, so another team’s',
      'numbering is not yours to avoid. If this pack is new, start at L1.',
    ].join('\n'),
    BOUNDARY: [
      '_Say what this pack covers, and fill `covers` in the output to match._',
      '',
      'The team that owns it, and the services that team runs — not every service',
      'the processes touch. A process reaching into somebody else’s service is a',
      'handoff, and handoffs are the most valuable thing in the pack.',
    ].join('\n'),
  }).replace(
    'Write it to `<pack>.json` and drop it in the architecture-map `inbox/`.',
    [
      'Write it to `<pack>.json`. Drop it in the Architecture Map’s `inbox/` and',
      'press **Sweep inbox**, or check it first with',
      '`npm run validate -- <pack>.json`, which routes on the shape and tells you',
      'which schema it picked.',
    ].join('\n')
  )

/* ── the schemas and worked examples, so the folder is self-contained ────── */

for (const [to, from] of [
  ['manifest.schema.json', ['schema', 'manifest.schema.json']],
  ['process-pack.schema.json', ['schema', 'process-pack.schema.json']],
  ['example.manifest.json', ['schema', 'example.payments-service.json']],
  ['example.process-pack.json', ['schema', 'example.order-and-execution.json']],
]) {
  files[to] = read(...from)
}

files['README.md'] = read('prompts', 'standalone-README.md')

/* ── write, or check ─────────────────────────────────────────────────────── */

fs.mkdirSync(OUT, { recursive: true })
const stale = []
for (const [name, body] of Object.entries(files)) {
  const file = path.join(OUT, name)
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (current === body) continue
  if (check) stale.push(name)
  else fs.writeFileSync(file, body)
}

if (check) {
  if (stale.length) {
    console.error(
      `✗ prompts/standalone/ is stale: ${stale.join(', ')}\n` +
        '  Run `npm run prompts`. These files are generated from prompts/ and schema/,\n' +
        '  so a schema change has to be rebuilt or the copy people are given is a lie.'
    )
    process.exit(1)
  }
  console.log(`✓ prompts/standalone/ is in sync (${Object.keys(files).length} files)`)
} else {
  console.log(
    `Wrote ${Object.keys(files).length} files to prompts/standalone/ — two prompts, two schemas, ` +
      'two worked examples and a README.'
  )
}
