import type { AccessMatrixResponse, UpdateAccessRequest } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accessApi } from '../../lib/api.js'

// The Access page's data seam: the effective matrix, and the owner's one write. The flip is
// optimistic — a switch answers the finger immediately — and every settle repaints from the
// server's truth: success carries the whole fresh matrix back, failure refetches it, so the
// page can never wedge on a stale optimistic state.

export const ACCESS_QUERY_KEY = ['access'] as const

export function useAccessMatrix() {
  return useQuery({ queryKey: ACCESS_QUERY_KEY, queryFn: accessApi.matrix })
}

export function useUpdateAccess() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAccessRequest) => accessApi.update(body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: ACCESS_QUERY_KEY })
      const previous = queryClient.getQueryData<AccessMatrixResponse>(ACCESS_QUERY_KEY)
      if (previous) {
        queryClient.setQueryData<AccessMatrixResponse>(ACCESS_QUERY_KEY, {
          ...previous,
          matrix: previous.matrix.map((row) =>
            row.capability === body.capability
              ? { ...row, byRole: { ...row.byRole, [body.role]: body.allowed } }
              : row,
          ),
        })
      }
      return { previous }
    },
    onSuccess: (response) => {
      queryClient.setQueryData(ACCESS_QUERY_KEY, response)
    },
    onError: (_error, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(ACCESS_QUERY_KEY, context.previous)
      }
      void queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY })
    },
  })
}
