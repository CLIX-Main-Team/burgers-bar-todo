import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api.js'

// One shared TanStack Query client for the SPA's server state (engineering-design:
// TanStack Query for server state). Auth failures are not worth retrying — a 401 means
// the session is gone, not that the network hiccuped — so retry is suppressed for
// ApiError while a genuine transport error still gets one retry.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry(failureCount, error) {
        if (error instanceof ApiError) {
          return false
        }
        return failureCount < 1
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
})
