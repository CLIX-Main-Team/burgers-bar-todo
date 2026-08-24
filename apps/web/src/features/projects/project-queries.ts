import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '../../lib/api.js'

// The projects cache keys. The detail key nests under the list key so invalidating the list after
// a write also refreshes any open detail — a project's counts change when its tasks do, and the
// two views must never disagree about the same project on the same screen.
export const PROJECTS_QUERY_KEY = ['projects'] as const

export const projectDetailKey = (id: string) => [...PROJECTS_QUERY_KEY, id] as const

export function useProjects() {
  return useQuery({ queryKey: PROJECTS_QUERY_KEY, queryFn: projectsApi.list })
}

export function useProject(id: string) {
  return useQuery({ queryKey: projectDetailKey(id), queryFn: () => projectsApi.detail(id) })
}
