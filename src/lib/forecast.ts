import type { Candle, TestConfig, Trade } from '../types'
import type { MarketMode } from './data'

export type ForecastModel = 'trend' | 'momentum' | 'mean-reversion'
export type StartingState = 'cash' | 'holding'

export type ForecastPoint = {
  time: number
  predicted: number
  lower: number
  upper: number
}

export type ForecastOutput = {
  points: ForecastPoint[]
  expectedReturn: number
  confidence: number
  direction: 'up' | 'down' | 'flat'
  action: 'BUY & HOLD' | 'HOLD CASH' | 'SELL / EXIT' | 'HOLD COIN' | 'OPEN SHORT' | 'NO TRADE'
}

export type ForecastScore = {
  directionCorrect: boolean | null
  actualReturn: number
  meanAbsolutePctError: number
  directionAccuracy: number
  finalEquity: number
  profitLoss: number
  returnPct: number
  endingState: 'cash' | 'holding'
  trades: Trade[]
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)

export function createForecast(training: Candle[], futureTimes: number[], model: ForecastModel, minimumReturnPct: number, minimumConfidencePct: number, startingState: StartingState, marketMode: MarketMode = 'spot'): ForecastOutput {
  const closes = training.map((candle) => candle.close)
  const base = closes.at(-1)!
  const logReturns = closes.slice(1).map((close, index) => Math.log(close / closes[index]))
  const recentReturns = logReturns.slice(-Math.min(240, logReturns.length))
  const volatility = Math.sqrt(mean(recentReturns.map((value) => (value - mean(recentReturns)) ** 2))) || 0.001
  const horizon = futureTimes.length
  let projected: number[] = []

  if (model === 'trend') {
    const sample = closes.slice(-Math.min(720, closes.length)).map(Math.log)
    const xMean = (sample.length - 1) / 2
    const yMean = mean(sample)
    const numerator = sample.reduce((sum, value, index) => sum + (index - xMean) * (value - yMean), 0)
    const denominator = sample.reduce((sum, _value, index) => sum + (index - xMean) ** 2, 0) || 1
    const slope = clamp(numerator / denominator, -volatility * 0.35, volatility * 0.35)
    projected = futureTimes.map((_time, index) => base * Math.exp(slope * 0.55 * (index + 1)))
  } else if (model === 'momentum') {
    const momentum = clamp(mean(logReturns.slice(-Math.min(48, logReturns.length))), -volatility * 0.3, volatility * 0.3)
    projected = futureTimes.map((_time, index) => base * Math.exp(momentum * Math.sqrt(index + 1)))
  } else {
    const target = mean(closes.slice(-Math.min(168, closes.length)))
    projected = futureTimes.map((_time, index) => target + (base - target) * Math.exp(-(index + 1) / Math.max(12, horizon * 0.35)))
  }

  const points = futureTimes.map((time, index) => {
    const uncertainty = volatility * Math.sqrt(index + 1) * 1.96
    return { time, predicted: projected[index], lower: projected[index] * Math.exp(-uncertainty), upper: projected[index] * Math.exp(uncertainty) }
  })
  const expectedReturn = projected.at(-1)! / base - 1
  const threshold = minimumReturnPct / 100
  const direction = expectedReturn > threshold ? 'up' : expectedReturn < -threshold ? 'down' : 'flat'
  const signalStrength = Math.abs(expectedReturn) / Math.max(volatility * Math.sqrt(horizon), 0.0001)
  const confidence = clamp(0.5 + signalStrength * 0.12, 0.5, 0.85)
  const passesConfidence = confidence * 100 >= minimumConfidencePct
  const action: ForecastOutput['action'] = marketMode === 'futures'
    ? !passesConfidence || direction === 'flat' ? 'NO TRADE' : direction === 'up' ? 'BUY & HOLD' : 'OPEN SHORT'
    : startingState === 'cash'
      ? direction === 'up' && passesConfidence ? 'BUY & HOLD' : 'HOLD CASH'
      : direction === 'down' && passesConfidence ? 'SELL / EXIT' : 'HOLD COIN'
  return { points, expectedReturn, confidence, direction, action }
}

export function createForecastFromPrices(training: Candle[], futureTimes: number[], projected: number[], minimumReturnPct: number, minimumConfidencePct: number, startingState: StartingState, marketMode: MarketMode = 'spot'): ForecastOutput {
  const closes = training.map((candle) => candle.close)
  const base = closes.at(-1)!
  const logReturns = closes.slice(1).map((close, index) => Math.log(close / closes[index]))
  const recentReturns = logReturns.slice(-Math.min(240, logReturns.length))
  const returnMean = mean(recentReturns)
  const volatility = Math.sqrt(mean(recentReturns.map((value) => (value - returnMean) ** 2))) || 0.001
  const points = futureTimes.map((time, index) => {
    const uncertainty = volatility * Math.sqrt(index + 1) * 1.96
    return { time, predicted: projected[index], lower: projected[index] * Math.exp(-uncertainty), upper: projected[index] * Math.exp(uncertainty) }
  })
  const expectedReturn = projected.at(-1)! / base - 1
  const threshold = minimumReturnPct / 100
  const direction = expectedReturn > threshold ? 'up' : expectedReturn < -threshold ? 'down' : 'flat'
  const confidence = clamp(0.5 + Math.abs(expectedReturn) / Math.max(volatility * Math.sqrt(futureTimes.length), 0.0001) * 0.12, 0.5, 0.85)
  const passesConfidence = confidence * 100 >= minimumConfidencePct
  const action: ForecastOutput['action'] = marketMode === 'futures'
    ? !passesConfidence || direction === 'flat' ? 'NO TRADE' : direction === 'up' ? 'BUY & HOLD' : 'OPEN SHORT'
    : startingState === 'cash'
      ? direction === 'up' && passesConfidence ? 'BUY & HOLD' : 'HOLD CASH'
      : direction === 'down' && passesConfidence ? 'SELL / EXIT' : 'HOLD COIN'
  return { points, expectedReturn, confidence, direction, action }
}

export function scoreForecast(training: Candle[], actual: Candle[], forecast: ForecastOutput, config: TestConfig, startingState: StartingState, options: { marketMode?: MarketMode; leverage?: number } = {}): ForecastScore {
  const base = training.at(-1)!.close
  const predictedReturn = forecast.points.at(-1)!.predicted / base - 1
  const actualReturn = actual.at(-1)!.close / base - 1
  const directionCorrect = Math.abs(predictedReturn) < 0.0001 ? null : (predictedReturn > 0) === (actualReturn > 0)
  const comparable = Math.min(actual.length, forecast.points.length)
  const errors = actual.slice(0, comparable).map((candle, index) => Math.abs(forecast.points[index].predicted - candle.close) / candle.close)
  let correctSteps = 0; let directionalSteps = 0
  for (let index = 0; index < comparable; index++) {
    const previousActual = index ? actual[index - 1].close : base
    const previousPredicted = index ? forecast.points[index - 1].predicted : base
    const predictedMove = forecast.points[index].predicted - previousPredicted
    const actualMove = actual[index].close - previousActual
    if (Math.abs(predictedMove) > 0.000001) { directionalSteps++; if ((predictedMove > 0) === (actualMove > 0)) correctSteps++ }
  }

  let cash = config.initialCapital
  let units = 0
  let entryPrice = 0
  const trades: Trade[] = []
  const feeRate = config.feeBps / 10_000
  const slipRate = config.slippageBps / 10_000
  const allocatedCapital = config.initialCapital * config.allocationPct / 100

  if (options.marketMode === 'futures') {
    const leverage = clamp(options.leverage ?? 1, 1, 20)
    const positionSide = forecast.action === 'BUY & HOLD' ? 'long' : forecast.action === 'OPEN SHORT' ? 'short' : null
    if (!positionSide) return { directionCorrect, actualReturn, meanAbsolutePctError: mean(errors), directionAccuracy: directionalSteps ? correctSteps / directionalSteps : 0, finalEquity: config.initialCapital, profitLoss: 0, returnPct: 0, endingState: 'cash', trades }
    const notional = allocatedCapital * leverage
    const entryBase = actual[0].open
    const entry = entryBase * (positionSide === 'long' ? 1 + slipRate : 1 - slipRate)
    let exitCandle = actual.at(-1)!
    let exitAtClose = true
    let exitReason = 'End of session exit'
    for (let index = 0; index < actual.length; index++) {
      const move = positionSide === 'long' ? actual[index].close / entry - 1 : entry / actual[index].close - 1
      if (move <= -config.stopLossPct / 100 || move >= config.takeProfitPct / 100) {
        exitCandle = actual[Math.min(index + 1, actual.length - 1)]; exitAtClose = index + 1 >= actual.length; exitReason = move < 0 ? 'Stop loss' : 'Take profit'; break
      }
    }
    const exitBase = exitAtClose ? exitCandle.close : exitCandle.open
    const exit = exitBase * (positionSide === 'long' ? 1 - slipRate : 1 + slipRate)
    const quantity = notional / entry
    const feeEachSide = notional * feeRate
    const priceReturn = positionSide === 'long' ? exit / entry - 1 : entry / exit - 1
    const profitLoss = Math.max(-allocatedCapital, notional * priceReturn - feeEachSide * 2)
    trades.push({ time: actual[0].time, side: positionSide === 'long' ? 'buy' : 'sell', price: entry, quantity, fee: feeEachSide, reason: `${leverage}x ${positionSide}` })
    trades.push({ time: exitCandle.time, side: positionSide === 'long' ? 'sell' : 'buy', price: exit, quantity, fee: feeEachSide, reason: exitReason })
    const finalEquity = config.initialCapital + profitLoss
    return { directionCorrect, actualReturn, meanAbsolutePctError: mean(errors), directionAccuracy: directionalSteps ? correctSteps / directionalSteps : 0, finalEquity, profitLoss, returnPct: profitLoss / config.initialCapital, endingState: 'cash', trades }
  }

  if (startingState === 'holding') {
    cash -= allocatedCapital; units = allocatedCapital / base; entryPrice = base
  }

  const buy = (candle: Candle, reason: string) => {
    const budget = Math.min(cash, cash * config.allocationPct / 100)
    const price = candle.open * (1 + slipRate); const fee = budget * feeRate; const quantity = (budget - fee) / price
    cash -= budget; units = quantity; entryPrice = price; trades.push({ time: candle.time, side: 'buy', price, quantity, fee, reason })
  }
  const sell = (candle: Candle, reason: string, atClose = false) => {
    const price = (atClose ? candle.close : candle.open) * (1 - slipRate); const proceeds = units * price; const fee = proceeds * feeRate
    cash += proceeds - fee; trades.push({ time: candle.time, side: 'sell', price, quantity: units, fee, reason }); units = 0; entryPrice = 0
  }

  if (forecast.action === 'BUY & HOLD') buy(actual[0], 'Forecast buy')
  if (forecast.action === 'SELL / EXIT' && units > 0) sell(actual[0], 'Forecast exit')
  for (let index = 0; index < actual.length && units > 0; index++) {
    const positionReturn = actual[index].close / entryPrice - 1
    if (positionReturn <= -config.stopLossPct / 100) sell(actual[Math.min(index + 1, actual.length - 1)], 'Stop loss')
    else if (positionReturn >= config.takeProfitPct / 100) sell(actual[Math.min(index + 1, actual.length - 1)], 'Take profit')
  }

  // Day-trading tests do not carry a simulated position beyond the chosen session.
  if (units > 0) sell(actual.at(-1)!, 'End of session exit', true)

  const finalEquity = cash + units * actual.at(-1)!.close
  return {
    directionCorrect,
    actualReturn,
    meanAbsolutePctError: mean(errors),
    directionAccuracy: directionalSteps ? correctSteps / directionalSteps : 0,
    finalEquity,
    profitLoss: finalEquity - config.initialCapital,
    returnPct: finalEquity / config.initialCapital - 1,
    endingState: units > 0 ? 'holding' : 'cash',
    trades,
  }
}
