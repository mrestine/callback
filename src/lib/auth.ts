import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface Me {
  login: string
  name: string | null
  avatar_url: string | null
}

/**
 * Current user, or null when signed out. `isPending` is true only on the very
 * first load. A 401 resolves to null rather than throwing (see api.ts).
 */
export function useMe() {
  const query = useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/auth/me')
      } catch {
        return null
      }
    },
    staleTime: 5 * 60_000,
  })
  return {
    me: query.data ?? null,
    isPending: query.isPending,
    isError: query.isError,
  }
}
