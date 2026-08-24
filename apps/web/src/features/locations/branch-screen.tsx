import { useParams } from 'react-router-dom'
import { useLocation } from './use-locations.js'

// The `/locations/:id` route's screen (round 12). Deliberately minimal: enough to make the
// route and the list's navigation into it real, with the rest — the edit form, address/city/
// phone, and the danger zone that inherits rename and delete from the old row Dialog — left
// for Task 3 to build in its place.
export function BranchScreen() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation(id ?? '')

  return <h1 dir="auto">{location?.name}</h1>
}
