import type { Candle } from '../types'

export type BinanceMarket = { symbol: string; baseAsset: string; quoteAsset: string }
export type MarketMode = 'spot' | 'futures'
const marketRequests: Partial<Record<MarketMode, Promise<BinanceMarket[]>>> = {}

export function fetchBinanceUsdtMarkets(mode: MarketMode = 'spot'): Promise<BinanceMarket[]> {
  if (marketRequests[mode]) return marketRequests[mode]!
  const endpoint = mode === 'futures' ? 'https://fapi.binance.com/fapi/v1/exchangeInfo' : 'https://api.binance.com/api/v3/exchangeInfo'
  marketRequests[mode] = fetch(endpoint)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Binance returned ${response.status}`)
      const payload = await response.json() as { symbols?: Array<{ symbol: string; baseAsset: string; quoteAsset: string; status: string; contractType?: string; isSpotTradingAllowed?: boolean }> }
      return (payload.symbols ?? [])
        .filter((market) => market.status === 'TRADING' && market.quoteAsset === 'USDT' && (mode === 'futures' ? market.contractType === 'PERPETUAL' : market.isSpotTradingAllowed !== false))
        .map(({ symbol, baseAsset, quoteAsset }) => ({ symbol, baseAsset, quoteAsset }))
        .sort((a, b) => a.baseAsset.localeCompare(b.baseAsset))
    })
    .catch((error) => { delete marketRequests[mode]; throw error })
  return marketRequests[mode]!
}

export const intervalMs: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
}

export function generateDemoCandles(count = 420, interval = '4h'): Candle[] {
  const step = intervalMs[interval] ?? intervalMs['4h']
  const start = Date.now() - count * step
  let price = 62_000
  let seed = 4711
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  return Array.from({ length: count }, (_, index) => {
    const regime = Math.sin(index / 38) * 0.0022
    const shock = (random() - 0.49) * 0.018
    const open = price
    const close = Math.max(100, open * (1 + regime + shock))
    const spread = open * (0.002 + random() * 0.008)
    price = close
    return {
      time: start + index * step,
      open,
      high: Math.max(open, close) + spread * random(),
      low: Math.min(open, close) - spread * random(),
      close,
      volume: 400 + random() * 1300,
    }
  })
}

export async function fetchBinanceCandles(symbol: string, interval: string, limit = 500, mode: MarketMode = 'spot'): Promise<Candle[]> {
  const safeSymbol = symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const baseUrl = mode === 'futures' ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3'
  const response = await fetch(`${baseUrl}/klines?symbol=${safeSymbol}&interval=${interval}&limit=${limit}`)
  if (!response.ok) throw new Error(`Binance returned ${response.status}. Try CSV or demo data if Binance is unavailable in your region.`)
  const rows = await response.json() as Array<Array<string | number>>
  return rows.map((row) => ({
    time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]),
  }))
}

export async function fetchBinanceRange(symbol: string, interval: string, startDate: string, endDate: string, maxBars = 5000, mode: MarketMode = 'spot'): Promise<Candle[]> {
  const safeSymbol = symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const step = intervalMs[interval]
  if (!step) throw new Error('Unsupported candle interval.')
  const parseBoundary = (value: string, end: boolean) => Date.parse(value.includes('T') ? `${value}${value.endsWith('Z') ? '' : 'Z'}` : `${value}T${end ? '23:59:59.999' : '00:00:00'}Z`)
  const startTime = parseBoundary(startDate, false)
  const endTime = parseBoundary(endDate, true)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) throw new Error('Choose a valid start date before the end date.')

  const candles: Candle[] = []
  let cursor = startTime
  while (cursor <= endTime && candles.length < maxBars) {
    const remaining = Math.min(1000, maxBars - candles.length)
    const baseUrl = mode === 'futures' ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3'
    const url = `${baseUrl}/klines?symbol=${safeSymbol}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=${remaining}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Binance returned ${response.status}. Check the symbol, dates, or regional availability.`)
    const rows = await response.json() as Array<Array<string | number>>
    if (!rows.length) break
    candles.push(...rows.map((row) => ({
      time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]),
    })))
    const nextCursor = Number(rows.at(-1)?.[0]) + step
    if (nextCursor <= cursor) break
    cursor = nextCursor
    if (rows.length < remaining) break
  }

  const unique = [...new Map(candles.map((candle) => [candle.time, candle])).values()].filter((candle) => candle.time <= endTime).sort((a, b) => a.time - b.time)
  if (unique.length < 80) throw new Error(`Only ${unique.length} candles were available. Choose a wider period or a smaller interval.`)
  if (unique.length >= maxBars && cursor <= endTime) throw new Error(`This range exceeds the ${maxBars.toLocaleString()}-candle safety limit. Choose a larger interval or shorter period.`)
  return unique
}

function findHeader(headers: string[], choices: string[]) {
  return headers.findIndex((header) => choices.includes(header.trim().toLowerCase()))
}

export function parseCsv(text: string): Candle[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 3) throw new Error('CSV needs a header and at least two rows.')
  const separator = lines[0].includes('\t') ? '\t' : ','
  const headers = lines[0].split(separator)
  const columns = {
    time: findHeader(headers, ['time', 'timestamp', 'date', 'datetime', 'open time']),
    open: findHeader(headers, ['open', 'o']), high: findHeader(headers, ['high', 'h']), low: findHeader(headers, ['low', 'l']),
    close: findHeader(headers, ['close', 'c', 'price']), volume: findHeader(headers, ['volume', 'vol', 'v']),
  }
  if (Object.entries(columns).some(([key, value]) => key !== 'volume' && value < 0)) throw new Error('CSV must contain time, open, high, low, and close columns.')
  const parsed = lines.slice(1).map((line) => {
    const cells = line.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ''))
    const rawTime = cells[columns.time]
    const numericTime = Number(rawTime)
    const time = Number.isFinite(numericTime) ? (numericTime < 10_000_000_000 ? numericTime * 1000 : numericTime) : Date.parse(rawTime)
    return {
      time, open: Number(cells[columns.open]), high: Number(cells[columns.high]), low: Number(cells[columns.low]), close: Number(cells[columns.close]),
      volume: columns.volume >= 0 ? Number(cells[columns.volume]) : 0,
    }
  }).filter((row) => Number.isFinite(row.time) && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0)
  if (parsed.length < 2) throw new Error('No valid OHLC rows were found.')
  return parsed.sort((a, b) => a.time - b.time)
}
