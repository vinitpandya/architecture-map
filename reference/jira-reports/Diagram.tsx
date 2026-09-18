import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, Banner } from '../components/ui'

const SOURCE_KEY = 'jira-reports.diagram.source'
const THEME_KEY = 'jira-reports.diagram.theme'

const EXAMPLE = `flowchart LR
  A[Idea raised] --> B{Worth doing?}
  B -- Yes --> C[Write the epic]
  B -- No --> D[Park it]
  C --> E[Estimate]
  E --> F[Build]
  F --> G[QA]
  G --> H([Done])`

type MermaidTheme = 'default' | 'neutral' | 'dark' | 'forest' | 'base'
const THEMES: { value: MermaidTheme; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'dark', label: 'Dark' },
  { value: 'forest', label: 'Forest' },
  { value: 'base', label: 'Base' },
]

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, text: string) => Promise<{ svg: string }>
}

let mermaidPromise: Promise<MermaidApi> | null = null
/** The renderer is bundled with the app and loaded on first use — no network. */
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default as unknown as MermaidApi)
  }
  return mermaidPromise
}

const safeName = (s: string) => (s.trim().replace(/[^\w.-]+/g, '-') || 'diagram').replace(/^-+|-+$/g, '')

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Mermaid source → preview → file. Everything runs in this browser: the
 * renderer is part of the app bundle and rasterising goes through a local
 * canvas, so no diagram text or image ever leaves the machine.
 */
export function DiagramPage() {
  const [source, setSource] = useState(() => localStorage.getItem(SOURCE_KEY) ?? EXAMPLE)
  const [theme, setTheme] = useState<MermaidTheme>(
    () => (localStorage.getItem(THEME_KEY) as MermaidTheme) || 'default'
  )
  const [filename, setFilename] = useState('diagram')
  const [scale, setScale] = useState(2)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [svg, setSvg] = useState<string>('')
  const previewRef = useRef<HTMLDivElement>(null)
  const renderSeq = useRef(0)

  useEffect(() => {
    localStorage.setItem(SOURCE_KEY, source)
  }, [source])
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // Debounced render on every edit or theme change.
  useEffect(() => {
    const seq = ++renderSeq.current
    const timer = window.setTimeout(async () => {
      if (!source.trim()) {
        setSvg('')
        setError(null)
        return
      }
      setRendering(true)
      try {
        const mermaid = await loadMermaid()
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
        const { svg: out } = await mermaid.render(`diagram-${seq}`, source)
        if (seq !== renderSeq.current) return
        setSvg(out)
        setError(null)
      } catch (err) {
        if (seq !== renderSeq.current) return
        setError(String((err as Error).message ?? err))
      } finally {
        if (seq === renderSeq.current) setRendering(false)
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [source, theme])

  /** The rendered SVG with explicit pixel dimensions so rasterisers size it. */
  const exportableSvg = useCallback((): { text: string; width: number; height: number } | null => {
    const el = previewRef.current?.querySelector('svg')
    if (!el) return null
    const clone = el.cloneNode(true) as SVGSVGElement
    const box = el.getBoundingClientRect()
    const vb = el.viewBox.baseVal
    const width = Math.max(1, Math.round(vb?.width || box.width))
    const height = Math.max(1, Math.round(vb?.height || box.height))
    clone.setAttribute('width', String(width))
    clone.setAttribute('height', String(height))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    clone.style.maxWidth = ''
    clone.style.height = ''
    return { text: new XMLSerializer().serializeToString(clone), width, height }
  }, [])

  const saveSvg = () => {
    const s = exportableSvg()
    if (!s) return
    download(new Blob([s.text], { type: 'image/svg+xml;charset=utf-8' }), `${safeName(filename)}.svg`)
  }

  const saveRaster = (type: 'image/png' | 'image/jpeg') => {
    const s = exportableSvg()
    if (!s) return
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = s.width * scale
      canvas.height = s.height * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      if (type === 'image/jpeg') {
        // JPEG has no alpha — paint a white page first.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0, s.width, s.height)
      canvas.toBlob(
        (blob) => {
          if (blob) download(blob, `${safeName(filename)}.${type === 'image/png' ? 'png' : 'jpg'}`)
        },
        type,
        0.95
      )
    }
    img.onerror = () => setError('Could not rasterise the SVG — try saving as SVG instead.')
    // A data URL keeps the canvas untainted so toBlob is allowed.
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.text)}`
  }

  const copySvg = async () => {
    const s = exportableSvg()
    if (!s) return
    await navigator.clipboard.writeText(s.text)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Diagrams</h1>
          <p>
            Paste or type Mermaid syntax and save the result as an image. The renderer is bundled
            with this app and runs entirely in your browser — nothing is sent anywhere.
          </p>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as MermaidTheme)}>
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
            File name
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              style={{ width: 150 }}
              aria-label="File name without extension"
            />
          </label>
          <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
            Scale
            <select value={scale} onChange={(e) => setScale(Number(e.target.value))} aria-label="Raster scale">
              {[1, 2, 3, 4].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!svg || !!error} onClick={saveSvg}>
            Save SVG
          </button>
          <button type="button" disabled={!svg || !!error} onClick={() => saveRaster('image/png')}>
            Save PNG
          </button>
          <button type="button" disabled={!svg || !!error} onClick={() => saveRaster('image/jpeg')}>
            Save JPEG
          </button>
          <button type="button" className="ghost" disabled={!svg || !!error} onClick={() => void copySvg()}>
            Copy SVG
          </button>
        </div>
      </div>

      {error && (
        <Banner kind="error" title="Mermaid could not parse this diagram">
          <pre className="diagram-error">{error}</pre>
        </Banner>
      )}

      <div className="diagram-layout">
        <Card
          title="Source"
          sub="Flowcharts, sequence, class, state, ER, Gantt, pie, mindmap, timeline…"
          actions={
            <button type="button" className="ghost" onClick={() => setSource(EXAMPLE)}>
              Load example
            </button>
          }
        >
          <textarea
            className="diagram-source"
            value={source}
            spellCheck={false}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Mermaid source"
          />
        </Card>

        <Card title="Preview" sub={rendering ? 'Rendering…' : svg ? 'Rendered locally' : 'Type something to preview'}>
          <div
            ref={previewRef}
            className="diagram-preview"
            style={error ? { opacity: 0.4 } : undefined}
            // Mermaid sanitises its output (securityLevel: strict) before it reaches us.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </Card>
      </div>
    </div>
  )
}
