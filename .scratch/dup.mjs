process.env.DATA_DIR = '.scratch/data3'
const { db } = await import('/home/user/architecture-map/server/src/db.js')
const { ingestProcessPack } = await import('/home/user/architecture-map/server/src/processes.js')
const base = (pack, processes) => ({ schemaVersion: 1, pack, name: pack, authoredAt: '2026-09-18T00:00:00Z', producer: { kind: 'human' }, processes })
const show = (label) => {
  console.log(`\n--- ${label}`)
  console.log('  processes:', db.prepare('SELECT code, pack_id, name FROM processes ORDER BY sort_key').all())
  console.log('  packs:', db.prepare('SELECT id,pack,status FROM process_packs').all())
  console.log('  dup findings:', db.prepare("SELECT subject_id, detail FROM drift WHERE kind='process-duplicate-code'").all())
}
ingestProcessPack(base('pack-a', [{ code: '5', name: 'A root' }, { code: '5.1', name: 'A child (owned by pack-a)' }]), 'a.json')
show('after pack-a')
ingestProcessPack(base('pack-b', [{ code: '6', name: 'B root' }, { code: '5.1', name: 'B copy of 5.1' }]), 'b.json')
show('after pack-b claims 5.1 too')
ingestProcessPack(base('pack-b', [{ code: '6', name: 'B root' }, { code: '6.1', name: 'B renumbered' }]), 'b.json')
show('after pack-b renumbers away from 5.1')
