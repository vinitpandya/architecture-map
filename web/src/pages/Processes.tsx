import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Process } from '../lib/api'
import { useScope } from '../lib/scope'
import { Empty } from '../components/ui'
import { ProcessTree } from '../components/ProcessTree'

/**
 * The whole L1/L2/L3 hierarchy. A navigation surface, not a report: dense
 * enough that a level 1 and its level 2 children fit on one screen, with the
 * atomic actions folded away until asked for.
 */
export function ProcessesPage() {
  const { status } = useScope()
  const [rows, setRows] = useState<Process[] | null>(null)
  const [openToLevel, setOpenToLevel] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ processes: Process[] }>('/processes')
      .then((d) => !cancelled && setRows(d.processes))
      .catch((err) => !cancelled && setError(String((err as Error).message)))
    return () => {
      cancelled = true
    }
  }, [status?.lastIngestAt])

  if (error) return <div className="page"><Empty title={error} /></div>
  if (!rows) return null

  const head = (
    <div className="page-head">
      <div>
        <h1>Processes</h1>
        <p>
          {rows.length
            ? `${rows.length} processes across ${status?.counts.processPacks ?? 0} packs, ${
                rows.filter((p) => p.childCount === 0).length
              } of them atomic. The levels are decomposition, not sequence — each one says the same thing in more detail.`
            : 'What the business does, and the components each part of it runs through.'}
        </p>
      </div>
      {rows.length > 0 && (
        <div className="segmented" role="group" aria-label="Expand to level">
          {[1, 2, 3].map((l) => (
            <button key={l} type="button" aria-pressed={openToLevel === l} onClick={() => setOpenToLevel(l)}>
              {l === 3 ? 'All' : `L${l + 1}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (!rows.length) {
    return (
      <div className="page">
        {head}
        <Empty title="No process packs loaded">
          <span className="muted" style={{ fontSize: 13 }}>
            A pack is written by people, not scanned — the knowledge is not in the codebase. Open{' '}
            <Link to="/scan">Scan</Link> for the authoring prompt, or run <code>npm run seed:demo</code>{' '}
            for the sample estate.
          </span>
        </Empty>
      </div>
    )
  }

  return (
    <div className="page">
      {head}
      <ProcessTree processes={rows} openToLevel={openToLevel} />
    </div>
  )
}
