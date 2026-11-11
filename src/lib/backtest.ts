import type { BacktestResult, BotOutput, Candle, TestConfig, Trade } from '../types'

export function runBacktest(candles: Candle[], outputs: BotOutput[], config: TestConfig): BacktestResult {
  let cash = config.initialCapital; let units = 0; let peak = config.initialCapital; let totalFees = 0
  const trades: Trade[] = []; const equity: BacktestResult['equity'] = []; const returns: number[] = []; const roundTrips: number[] = []
  let entryValue = 0; let entryPrice = 0
  candles.forEach((candle, index) => {
    const output = outputs[index]
    const executionPrice = index + 1 < candles.length ? candles[index + 1].open : candle.close
    const confidenceOk = (output?.confidence ?? 0) * 100 >= config.minConfidencePct
    const expectedReturnOk = (output?.expectedReturn ?? 0) * 100 >= config.minExpectedReturnPct
    const positionReturn = units > 0 && entryPrice > 0 ? candle.close / entryPrice - 1 : 0
    const stopTriggered = units > 0 && positionReturn <= -config.stopLossPct / 100
    const targetTriggered = units > 0 && positionReturn >= config.takeProfitPct / 100
    if (output?.signal === 'buy' && confidenceOk && expectedReturnOk && units === 0 && index + 1 < candles.length) {
      const budget = cash * config.allocationPct / 100; const price = executionPrice * (1 + config.slippageBps / 10_000); const fee = budget * config.feeBps / 10_000
      const quantity = Math.max(0, (budget - fee) / price); cash -= quantity * price + fee; units = quantity; totalFees += fee; entryValue = quantity * price + fee; entryPrice = price
      trades.push({ time: candles[index + 1].time, side: 'buy', price, quantity, fee, reason: `${output.direction} · ${(output.confidence * 100).toFixed(0)}% confidence` })
    } else if ((output?.signal === 'sell' || stopTriggered || targetTriggered) && units > 0 && index + 1 < candles.length) {
      const price = executionPrice * (1 - config.slippageBps / 10_000); const proceeds = units * price; const fee = proceeds * config.feeBps / 10_000
      cash += proceeds - fee; totalFees += fee; roundTrips.push((proceeds - fee - entryValue) / entryValue)
      const reason = stopTriggered ? `Stop loss · ${(positionReturn * 100).toFixed(2)}%` : targetTriggered ? `Take profit · +${(positionReturn * 100).toFixed(2)}%` : `${output.direction} · ${(output.confidence * 100).toFixed(0)}% confidence`
      trades.push({ time: candles[index + 1].time, side: 'sell', price, quantity: units, fee, reason }); units = 0; entryPrice = 0
    }
    const value = cash + units * candle.close; peak = Math.max(peak, value); const previous = equity.at(-1)?.value ?? config.initialCapital
    returns.push(value / previous - 1)
    equity.push({ time: candle.time, value, benchmark: config.initialCapital * candle.close / candles[0].close, drawdown: value / peak - 1 })
  })
  const finalEquity = equity.at(-1)?.value ?? config.initialCapital
  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1)
  const deviation = Math.sqrt(returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / Math.max(returns.length - 1, 1))
  let correct = 0; let eligible = 0
  outputs.slice(0, -1).forEach((item, index) => { if (item.direction !== 'flat') { eligible++; const actualUp = candles[index + 1].close > candles[index].close; if ((item.direction === 'up') === actualUp) correct++ } })
  return {
    outputs, trades, equity,
    metrics: {
      netReturn: finalEquity / config.initialCapital - 1,
      benchmarkReturn: candles.at(-1)!.close / candles[0].close - 1,
      maxDrawdown: Math.min(...equity.map((item) => item.drawdown)),
      sharpe: deviation ? meanReturn / deviation * Math.sqrt(365 * 6) : 0,
      winRate: roundTrips.length ? roundTrips.filter((value) => value > 0).length / roundTrips.length : 0,
      directionalAccuracy: eligible ? correct / eligible : 0,
      totalTrades: trades.length, totalFees, finalEquity,
    },
  }
}

export function costLabel(config: TestConfig) { return `${config.feeBps + config.slippageBps} bps round-trip model` }
