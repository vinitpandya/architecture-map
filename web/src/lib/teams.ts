import { api } from './api'

/**
 * SPEC-ORG §2's normalisation rule, on the client.
 *
 * The server's `teamId()` is the authority and this is not allowed to disagree
 * with it. It exists because renaming a team can move its id, and a rename
 * that moves an id is something you should see coming rather than discover
 * from the address bar afterwards — so the editor has to be able to say what
 * the id will be before the request is sent.
 *
 * The rule is a published contract rather than an implementation detail, which
 * is why it is safe to state twice; `verify:ui` renames a team and asserts that
 * what this predicted is what the server did, so the two cannot drift apart
 * quietly.
 */
export const teamIdOf = (name: string) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * Put a component in a team, or take the correction away again.
 *
 * `null` deletes the override rather than writing an empty one, so the node
 * goes back to whatever the scan said. An empty string is a different
 * statement — "this belongs to nobody" — and is stored as one, because a
 * service the scan guessed a team for and a person disowned is not the same as
 * a service nobody has looked at.
 */
export async function assignTeam(nodeId: string, team: string | null) {
  if (team === null) {
    await api.del(
      `/override?subjectKind=node&subjectId=${encodeURIComponent(nodeId)}&field=team`
    )
    return
  }
  await api.put('/override', { subjectKind: 'node', subjectId: nodeId, field: 'team', value: team })
}
