import type { TaskSubject } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { taskSubjectsApi } from '../../lib/api.js'
import { queryClient } from '../../lib/query-client.js'

// The subjects a department's shared work is filed under (2026-09-20), one cache entry per
// department under a common root so a write anywhere on the subjects surface, or a task change
// arriving on the live channel, refreshes every department's cards with one invalidation.
export const SUBJECTS_QUERY_ROOT = ['task-subjects'] as const

export const subjectsQueryKey = (departmentId: string) =>
  [...SUBJECTS_QUERY_ROOT, 'department', departmentId] as const

export const subjectQueryKey = (subjectId: string) =>
  [...SUBJECTS_QUERY_ROOT, 'one', subjectId] as const

// The cards of one department. Off while there is no department to ask for (an unplaced viewer,
// or the chips still deciding), which the screen shows as its own empty state.
export function useSubjects(departmentId: string | null) {
  return useQuery({
    queryKey: subjectsQueryKey(departmentId ?? ''),
    queryFn: () => taskSubjectsApi.list(departmentId as string).then((r) => r.subjects),
    enabled: departmentId !== null,
  })
}

// Every subject the viewer reaches, across departments: the task form's picker, which files a
// task anywhere the writer may see. Off for a reader who never opens the form.
export function useAllSubjects({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...SUBJECTS_QUERY_ROOT, 'all'] as const,
    queryFn: () => taskSubjectsApi.list().then((r) => r.subjects),
    enabled,
  })
}

// One subject by id, for the screen that opens on `/tasks/subjects/:id` and knows nothing else
// about it yet. A 404 (deleted, or outside the viewer's department) is the not-found state, not
// something to retry.
export function useSubject(subjectId: string) {
  return useQuery<TaskSubject>({
    queryKey: subjectQueryKey(subjectId),
    queryFn: () => taskSubjectsApi.get(subjectId),
    // The screen calls this on every level with '' when no subject is open; nothing to fetch.
    enabled: subjectId !== '',
    retry: false,
  })
}

// Every card's counts and faces are the server's answer over the viewer's own scope, so the
// cards refresh from the server rather than being patched by hand: after a subject write, and on
// every task change the live channel delivers (a task moved, finished, assigned).
export function invalidateSubjects(): void {
  void queryClient.invalidateQueries({ queryKey: SUBJECTS_QUERY_ROOT })
}
