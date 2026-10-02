import { useCallback, useRef, useState } from 'react'
import { readBarkAccount } from '../services/BarkService'
import { BARK_ENABLED } from '../services/protocols/bark'

export function useBark() {
  const [data, setData] = useState<Awaited<ReturnType<typeof readBarkAccount>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const refresh = useCallback(async (opts: { sync?: boolean } = {}) => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError(null)
    try { setData(await readBarkAccount(opts.sync)) }
    catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Could not read Bark account')
    } finally { busy.current = false; setLoading(false) }
  }, [])
  return { enabled: BARK_ENABLED, connected: data !== null, ...data, loading, error, refresh }
}
