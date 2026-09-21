import { useEffect, useMemo, useState } from 'react'
import type { Process } from '../lib/api'
import { useThemeVersion } from '../components/ui'
import { sequenceDiagram } from './processDiagrams'

/**
 * A mermaid diagram, themed and rendered on demand.
 *
 * The generators live in `processDiagrams.ts`; this is only the renderer, and
 * it is the renderer for all five of them — the theming, the lazy import and
 * the "show me the source when it will not draw" fallback are identical
 * whatever the diagram says.
 */

export function Mermaid({ source, label }: { source: string; label: string }) {
  const theme = useThemeVersion()
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)

    // mermaid is a large dependency and only these views need it.
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        const dark =
          document.documentElement.dataset.theme === 'dark' ||
          (!document.documentElement.dataset.theme &&
            window.matchMedia('(prefers-color-scheme: dark)').matches)
        const read = (name: string) =>
          getComputedStyle(document.documentElement).getPropertyValue(name).trim()

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'base',
          fontFamily: getComputedStyle(document.body).fontFamily,
          // Mermaid's flowchart defaults are drawn for a slide, not a card.
          flowchart: { padding: 8, nodeSpacing: 28, rankSpacing: 44, useMaxWidth: true },
          themeVariables: {
            background: read('--surface-1'),
            primaryColor: read('--surface-2'),
            primaryTextColor: read('--text-primary'),
            primaryBorderColor: read('--series-1'),
            lineColor: read('--axis'),
            textColor: read('--text-primary'),
            actorBkg: read('--surface-2'),
            actorBorder: read('--series-1'),
            actorTextColor: read('--text-primary'),
            actorLineColor: read('--axis'),
            signalColor: read('--text-secondary'),
            signalTextColor: read('--text-secondary'),
            noteBkgColor: read('--surface-2'),
            noteTextColor: read('--text-secondary'),
            noteBorderColor: read('--border'),
            sequenceNumberColor: read('--surface-1'),
            // The flowcharts, which the sequence variables do not reach.
            nodeBorder: read('--series-1'),
            mainBkg: read('--surface-2'),
            clusterBkg: read('--surface-1'),
            clusterBorder: read('--border'),
            edgeLabelBackground: read('--surface-1'),
            tertiaryColor: read('--surface-1'),
            // A flowchart's default is 16px, which makes a four-step diagram
            // taller than the screen. The app reads at 12–13.
            fontSize: '13px',
          },
        })

        // A fresh id per render; mermaid caches by id and would reuse a stale
        // themed copy when the theme changes underneath it.
        const id = `dg-${theme}-${hash(source)}`
        const { svg: rendered } = await mermaid.render(id, source)
        if (!cancelled) setSvg(rendered)
      })
      .catch((err) => !cancelled && setError(String((err as Error).message)))

    return () => {
      cancelled = true
    }
  }, [source, theme])

  if (error) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          The diagram could not be drawn: {error}
        </p>
        <pre className="prompt-box">
          <code>{source}</code>
        </pre>
      </div>
    )
  }

  if (!svg) return <span className="spinner" />

  return (
    <div
      className="proc-diagram"
      role="img"
      aria-label={label}
      // mermaid's own output, rendered from a string this app generated.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** Enough to tell two sources apart in a DOM id. Not a checksum. */
function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

/**
 * The sequence diagram, which is what a process page and the `process-flow`
 * widget both showed before there were five of them.
 */
export function ProcessFlow({
  children,
  nameOf,
  title,
}: {
  children: Process[]
  nameOf: (id: string) => string
  title: string
}) {
  const source = useMemo(() => sequenceDiagram(children, nameOf, title), [children, nameOf, title])
  return <Mermaid source={source} label={`Sequence diagram of ${title}`} />
}
