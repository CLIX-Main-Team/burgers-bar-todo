import { useSession } from '../../auth/session.js'
import { AccessMatrix } from './access-matrix.js'

// The Access screen: thin route shell over the matrix, the people/locations split.
// Ungated on purpose — the page only DESCRIBES the role map, and an employee seeing what
// their role covers is the point, not a leak (every rule is enforced by the API anyway).
export function AccessScreen() {
  const { principal } = useSession()

  // RequireAuth guarantees a principal; the check narrows the type.
  if (!principal) {
    return null
  }

  return <AccessMatrix principal={principal} />
}
