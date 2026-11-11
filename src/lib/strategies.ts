import type { BotDefinition, BotOutput, Candle } from '../types'

export const builtInBots: BotDefinition[] = [
  { id: 'sma-cross', name: 'EMA Momentum Scalp', description: 'A fast intraday trend bot tuned for 5–15 minute candles. It enters when short momentum separates from the slower trend.', category: 'Day trend', source: 'built-in', params: { fast: 9, slow: 21, threshold: 0.0005 } },
  { id: 'mean-reversion', name: 'RSI Pullback Scalp', description: 'Looks for short-term intraday exhaustion and a quick move back toward normal. Best tested on 5–15 minute candles.', category: 'Day reversal', source: 'built-in', params: { period: 9, oversold: 35, overbought: 65 } },
  { id: 'breakout', name: 'Volume Breakout', description: 'Trades a break of the recent intraday range only when volume confirms the move.', category: 'Day breakout', source: 'built-in', params: { lookback: 12, volumeFactor: 1.2, buffer: 0.0005 } },
  { id: 'vwap-scalp', name: 'VWAP Reversion Scalp', description: 'Compares price with a rolling volume-weighted average and trades larger intraday deviations back toward it.', category: 'VWAP scalp', source: 'built-in', params: { lookback: 48, deviation: 0.002 } },
]

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1) }
function ema(values: number[]) { const multiplier = 2 / (values.length + 1); return values.slice(1).reduce((value, next) => next * multiplier + value * (1 - multiplier), values[0] ?? 0) }

function output(time: number, close: number, expectedReturn: number, confidence: number, signal: BotOutput['signal']): BotOutput {
  const direction = expectedReturn > 0.0002 ? 'up' : expectedReturn < -0.0002 ? 'down' : 'flat'
  return { time, predictedPrice: close * (1 + expectedReturn), direction, confidence: Math.min(0.95, Math.max(0.5, confidence)), expectedReturn, signal }
}

export function runBuiltInBot(botId: string, candles: Candle[], params: Record<string, number>): BotOutput[] {
  return candles.map((candle, index) => {
    if (botId === 'sma-cross') {
      const fast = Math.max(2, Math.round(params.fast ?? 12)); const slow = Math.max(fast + 1, Math.round(params.slow ?? 36))
      if (index < slow) return output(candle.time, candle.close, 0, 0.5, 'hold')
      const fastAvg = ema(candles.slice(index - fast + 1, index + 1).map((item) => item.close))
      const slowAvg = ema(candles.slice(index - slow + 1, index + 1).map((item) => item.close))
      const edge = (fastAvg - slowAvg) / slowAvg
      const threshold = params.threshold ?? 0.001
      return output(candle.time, candle.close, edge * 0.35, 0.5 + Math.abs(edge) * 16, edge > threshold ? 'buy' : edge < -threshold ? 'sell' : 'hold')
    }
    if (botId === 'mean-reversion') {
      const period = Math.max(3, Math.round(params.period ?? 14))
      if (index < period) return output(candle.time, candle.close, 0, 0.5, 'hold')
      const changes = candles.slice(index - period, index + 1).map((item, offset, items) => offset ? item.close - items[offset - 1].close : 0).slice(1)
      const gains = mean(changes.map((change) => Math.max(0, change))); const losses = mean(changes.map((change) => Math.max(0, -change)))
      const rsi = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses)
      const expected = (50 - rsi) / 50 * 0.006
      return output(candle.time, candle.close, expected, 0.5 + Math.abs(50 - rsi) / 100, rsi < (params.oversold ?? 30) ? 'buy' : rsi > (params.overbought ?? 70) ? 'sell' : 'hold')
    }
    if (botId === 'vwap-scalp') {
      const lookback = Math.max(5, Math.round(params.lookback ?? 48))
      if (index < lookback) return output(candle.time, candle.close, 0, 0.5, 'hold')
      const history = candles.slice(index - lookback + 1, index + 1)
      const totalVolume = history.reduce((sum, item) => sum + item.volume, 0) || 1
      const vwap = history.reduce((sum, item) => sum + ((item.high + item.low + item.close) / 3) * item.volume, 0) / totalVolume
      const distance = (candle.close - vwap) / vwap
      const deviation = params.deviation ?? 0.002
      const signal = distance < -deviation ? 'buy' : distance > deviation ? 'sell' : 'hold'
      return output(candle.time, candle.close, -distance * 0.35, 0.5 + Math.abs(distance) * 24, signal)
    }
    const lookback = Math.max(3, Math.round(params.lookback ?? 12))
    if (index < lookback) return output(candle.time, candle.close, 0, 0.5, 'hold')
    const history = candles.slice(index - lookback, index)
    const rangeHigh = Math.max(...history.map((item) => item.high)); const rangeLow = Math.min(...history.map((item) => item.low)); const avgVolume = mean(history.map((item) => item.volume))
    const volumeOk = candle.volume >= avgVolume * (params.volumeFactor ?? 1.05); const buffer = params.buffer ?? 0.001
    const signal = volumeOk && candle.close > rangeHigh * (1 + buffer) ? 'buy' : volumeOk && candle.close < rangeLow * (1 - buffer) ? 'sell' : 'hold'
    const expected = signal === 'buy' ? 0.004 : signal === 'sell' ? -0.004 : 0
    return output(candle.time, candle.close, expected, volumeOk ? 0.64 : 0.51, signal)
  })
}

export const defaultPythonCode = `# Runs inside an isolated browser worker using Pyodide.
# Return one result for every candle. Use only information at or before index i.
def generate_signals(candles, params):
    window = int(params.get("window", 20))
    results = []
    for i, candle in enumerate(candles):
        closes = [x["close"] for x in candles[max(0, i-window+1):i+1]]
        avg = sum(closes) / len(closes)
        edge = (candle["close"] - avg) / avg if avg else 0
        signal = "buy" if edge > 0.003 else "sell" if edge < -0.003 else "hold"
        results.append({
            "time": candle["time"],
            "predictedPrice": candle["close"] * (1 + edge * 0.25),
            "direction": "up" if edge > 0 else "down",
            "confidence": min(0.90, 0.50 + abs(edge) * 12),
            "expectedReturn": edge * 0.25,
            "signal": signal,
        })
    return results`
