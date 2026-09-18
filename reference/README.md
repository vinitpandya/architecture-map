# reference/jira-reports

Read-only excerpts from the sibling `jira-reports` project, which this one is
modelled on. They are here because the build happens in a container that does
not have that repo.

**Nothing here is part of the build.** Do not import from it. Read it to match
the house style, then delete this whole folder in Phase 6.

| File | Read it for |
|---|---|
| `App.tsx` | The shell: sidebar, nav groups, theme toggle, sidebar foot, inline SVG icon convention |
| `api.ts` | The shape of the API client — `ApiError`, the thin `api` object, exported response types |
| `scope.tsx` | The filter-row context provider pattern the `FilterBar` should follow |
| `ScopeBar.tsx` | How the filter row looks and behaves |
| `Settings.tsx` | Page structure for the operator screen (`/scan`) |
| `dashboards.tsx` | The addable-pages provider — phase 3, not v1 |
| `Diagram.tsx` | Loading mermaid lazily and offline — phase 2, for process flows |
| `db.js` | How the SQLite schema is created on boot |
| `routes.js` | Express router conventions, error handling, response shapes |
| `index.js` | Server bootstrap, static serving of the built UI |

What to notice: no state library, no CSS-in-JS, plain `useEffect` + `useState`,
comments that explain *why*, icons defined at the bottom of the file that uses
them, and CSS driven entirely by the tokens in `theme.css`.
