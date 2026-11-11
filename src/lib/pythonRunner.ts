import type { BotOutput, Candle } from '../types'

export function runPythonBot(code: string, candles: Candle[], params: Record<string, number>, timeoutMs = 20_000): Promise<BotOutput[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/python-bot-worker.js')
    const timeout = window.setTimeout(() => {
      worker.terminate()
      reject(new Error('Python bot exceeded the 20-second execution limit.'))
    }, timeoutMs)
    worker.onmessage = (event) => {
      window.clearTimeout(timeout); worker.terminate()
      if (!event.data.ok) { reject(new Error(event.data.error)); return }
      const result = event.data.result as BotOutput[]
      if (!Array.isArray(result) || result.length !== candles.length) { reject(new Error('Python bot must return one output for every candle.')); return }
      resolve(result)
    }
    worker.onerror = (event) => { window.clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || 'Python worker failed to start.')) }
    worker.postMessage({ code, candles, params, mode: 'signals' })
  })
}

export function runPythonForecast(code: string, candles: Candle[], futureTimes: number[], params: Record<string, number>, timeoutMs = 30_000): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/python-bot-worker.js')
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Python forecast exceeded the 30-second execution limit.')) }, timeoutMs)
    worker.onmessage = (event) => {
      window.clearTimeout(timeout); worker.terminate()
      if (!event.data.ok) { reject(new Error(event.data.error)); return }
      const raw = event.data.result as Array<number | { predictedPrice?: number; predicted?: number }>
      if (!Array.isArray(raw) || raw.length !== futureTimes.length) { reject(new Error('forecast_prices must return one predicted price for every future timestamp.')); return }
      const prices = raw.map((item) => typeof item === 'number' ? item : Number(item.predictedPrice ?? item.predicted))
      if (prices.some((price) => !Number.isFinite(price) || price <= 0)) { reject(new Error('Every forecast price must be a positive number.')); return }
      resolve(prices)
    }
    worker.onerror = (event) => { window.clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || 'Python forecast worker failed to start.')) }
    worker.postMessage({ code, candles, params, mode: 'forecast', futureTimes })
  })
}
