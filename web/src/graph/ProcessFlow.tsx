import { useEffect, useMemo, useRef, useState } from 'react'
import type { Process } from '../lib/api'
import { useThemeVersion } from '../components/ui'
import { flowDirection, flowVerb, idValue } from '../lib/nodes'

/**
 * A process drawn as a sequence diagram, generated from its children in order.
 *
 * Because the levels are decomposition and the numbering is the order, the
 * children ARE the flow — so this works at every level without a second data
 * model: L2 draws its stages, L2.1 draws its four actions.
 *
 * This closes the loop with where the project started: hand-drawn mermaid
 * process diagrams, except these are generated from data that is checked
 * against the code.
 */

/**
 * Who appears on the diagram. An endpoint is drawn as the service that serves
 * it — `api:pricing-service/GET /v1/rates/{}` carries the service name in the
 * id by construction (see the schema's nodeId), and "gateway → pricing-service"
 * reads as a call where "gateway → GET /v1/rates/{}" reads as a shrug.
 */
const participantFor = (id: string) =>
  id.startsWith('api:') ? `svc:${idValue(id).split('/')[0]}` : id

/**
 * Mermaid takes everything after `as` as the label and everything after `:` as
 * a message, so anything that would end either statement has to go. Quoting
 * the label is not the answer — mermaid renders the quotes.
 */
const clean = (s: string) => s.replace(/["'`;:#<>\n]/g, ' ').replace(/\s+/g, ' ').trim()

export function processDiagram(
  children: Process[],
  nameOf: (id: string) => string,
  title = 'This process'
): string {
  const lines = ['sequenceDiagram', '  autonumber']
  const alias = new Map<string, string>()
  const declare = (id: string, label?: string) => {
    if (alias.has(id)) return alias.get(id)!
    const key = `P${alias.size}`
    alias.set(id, key)
    lines.push(`  participant ${key} as ${clean(label ?? nameOf(id)) || key}`)
    return key
  }

  // Participants are declared in order of first appearance, which is the order
  // the reader meets them: an interaction's two ends, or — for a step with no
  // interaction of its own — the component it happens at.
  for (const child of children) {
    if (child.edge) {
      const { source, target } = flowDirection(child.edge)
      declare(participantFor(source))
      declare(participantFor(target))
    } else if (child.node) {
      declare(participantFor(child.node))
    }
  }

  // A level 1's stages usually name nothing at all — decomposition is the
  // point, and the detail lives a level down. The process itself is then the
  // only participant there is, and each stage is a note against it. Without
  // this the diagram referred to a `P0` it never declared.
  const fallback = alias.size ? null : declare('__process__', title)

  for (const child of children) {
    const label = clean(`${child.code} ${child.name}`)
    if (!child.edge) {
      // Nothing to draw an arrow between, but the step still happened — and it
      // is drawn against the thing it happens at when it names one.
      const at = child.node ? alias.get(participantFor(child.node)) : undefined
      lines.push(`  Note over ${at ?? fallback ?? [...alias.values()][0]}: ${label}`)
      continue
    }
    const { source, target } = flowDirection(child.edge)
    const from = declare(participantFor(source))
    const to = declare(participantFor(target))
    const verb = flowVerb(child.edge.kind)
    // A dashed arrow for an interaction the code does not have, so an
    // unresolved step is visibly different rather than quietly the same.
    const arrow = child.edge.id ? '->>' : '-->>'
    lines.push(`  ${from}${arrow}${to}: ${label}`)
    if (!child.edge.id) lines.push(`  Note right of ${to}: ${clean(verb)} — not in the map`)
  }

  if (!children.length) lines.push(`  Note over ${declare('__process__', title)}: nothing to draw`)
  return lines.join('\n')
}

export function ProcessFlow({
  children,
  nameOf,
  title,
}: {
  children: Process[]
  nameOf: (id: string) => string
  title: string
}) {
  const theme = useThemeVersion()
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const source = useMemo(() => processDiagram(children, nameOf, title), [children, nameOf, title])

  useEffect(() => {
    let cancelled = false
    setError(null)

    // mermaid is a large dependency and only this one view needs it.
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
          },
        })

        // A fresh id per render; mermaid caches by id and would reuse a stale
        // themed copy when the theme changes underneath it.
        const id = `flow-${theme}-${children.length}-${source.length}`
        const { svg: rendered } = await mermaid.render(id, source)
        if (!cancelled) setSvg(rendered)
      })
      .catch((err) => !cancelled && setError(String((err as Error).message)))

    return () => {
      cancelled = true
    }
  }, [source, theme, children.length])

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
      ref={host}
      className="proc-diagram"
      role="img"
      aria-label={`Sequence diagram of ${title}`}
      // mermaid's own output, rendered from a string this file generated.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
