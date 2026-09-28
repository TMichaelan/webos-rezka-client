import type { Methods } from './types'

interface Bridge { onservicecallback: (response: string) => void; call(uri: string, payload: string): void; cancel(): void }
declare global { interface Window { PalmServiceBridge?: new () => Bridge } }
type Reply = { returnValue: boolean; result?: unknown; errorCode?: string; errorText?: string; retryable?: boolean }
export class ApiError extends Error {
  constructor(public code: string, message: string, public retryable = false) { super(message); this.name = 'ApiError' }
}

const writes = new Set(['login', 'logout', 'configure', 'setBookmark', 'setEpisodeWatched', 'saveProgress'])
const device = location.protocol === 'file:' || !!window.PalmServiceBridge

export const api = {
  onAuthRequired: undefined as (() => void) | undefined,
  mode: (device ? 'device' : import.meta.env.VITE_FIXTURE === '1' ? 'fixture' : 'live') as 'device' | 'fixture' | 'live',
  async call<K extends keyof Methods>(method: K, params: Methods[K]['params'], options: { signal?: AbortSignal } = {}): Promise<Methods[K]['result']> {
    const authRequired = this.onAuthRequired
    const signal = writes.has(method) ? undefined : options.signal
    if (signal?.aborted) throw new ApiError('ABORTED', 'Запрос отменён.')
    const payload = JSON.stringify({ method, params })
    let reply: Reply
    if (device) {
      if (!window.PalmServiceBridge) throw new ApiError('SERVICE_UNAVAILABLE', 'Сетевой сервис webOS недоступен. Переустановите полный IPK.')
      reply = await new Promise<Reply>((resolve, reject) => {
        const bridge = new window.PalmServiceBridge!()
        let done = false
        const finish = (error?: Error, result?: Reply) => {
          if (done) return
          done = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          try { bridge.cancel() } catch { /* already completed */ }
          if (error) reject(error); else resolve(result!)
        }
        const abort = () => finish(new ApiError('ABORTED', 'Запрос отменён.'))
        const timer = setTimeout(() => finish(new ApiError('TIMEOUT', 'Сетевой сервис не ответил вовремя.', true)), 60000)
        signal?.addEventListener('abort', abort, { once: true })
        bridge.onservicecallback = (raw) => {
          try { finish(undefined, JSON.parse(raw)) } catch { finish(new ApiError('INVALID_RESPONSE', 'Некорректный ответ сетевого сервиса.')) }
        }
        try { bridge.call('luna://io.github.tmichaelan.app.rezkaclient.service/rpc', payload) }
        catch { finish(new ApiError('SERVICE_UNAVAILABLE', 'Не удалось запустить сетевой сервис.', true)) }
      })
    } else {
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(abort, 60000)
      try {
        const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: controller.signal })
        if (!response.ok) throw new ApiError('NETWORK_ERROR', 'Локальный сервис недоступен.', true)
        reply = await response.json()
      } catch (error) {
        if (error instanceof ApiError) throw error
        throw new ApiError(signal?.aborted ? 'ABORTED' : controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', signal?.aborted ? 'Запрос отменён.' : 'Нет ответа сетевого сервиса.', !signal?.aborted)
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    }
    if (!reply.returnValue) {
      if (reply.errorCode === 'AUTH_REQUIRED' && method !== 'status') authRequired?.()
      throw new ApiError(reply.errorCode || 'SERVICE_ERROR', reply.errorText || 'Ошибка сетевого сервиса.', !!reply.retryable)
    }
    return reply.result as Methods[K]['result']
  },
}
