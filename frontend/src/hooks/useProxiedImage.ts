import { useQuery } from '@tanstack/react-query'
import { proxiedImageUrl } from '../api/imageProxy'

/** The proxied URL for a remote image, `undefined` while loading, `null` if it can't be shown. */
export function useProxiedImage(url: string): string | null | undefined {
  const { data } = useQuery({
    queryKey: ['image-proxy', url],
    queryFn: () => proxiedImageUrl(url),
    // Signatures are valid for at least 24 h.
    staleTime: 12 * 60 * 60_000,
    gcTime: 12 * 60 * 60_000,
    retry: false,
  })
  return data
}
