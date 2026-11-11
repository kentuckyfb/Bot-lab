export type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type BotOutput = {
  time: number
  predictedPrice: number
  direction: 'up' | 'down' | 'flat'
  confidence: number
  expectedReturn: number
  signal: 'buy' | 'sell' | 'hold'
}

export type Trade = {
  time: number
  side: 'buy' | 'sell'
  price: number
  quantity: number
  fee: number
  reason: string
}

export type EquityPoint = { time: number; value: number; benchmark: number; drawdown: number }

export type BotDefinition = {
  id: string
  name: string
  description: string
  category: string
  params: Record<string, number>
  source: 'built-in' | 'python'
}

export type BacktestResult = {
  outputs: BotOutput[]
  trades: Trade[]
  equity: EquityPoint[]
  metrics: {
    netReturn: number
    benchmarkReturn: number
    maxDrawdown: number
    sharpe: number
    winRate: number
    directionalAccuracy: number
    totalTrades: number
    totalFees: number
    finalEquity: number
  }
}

export type TestConfig = {
  initialCapital: number
  feeBps: number
  slippageBps: number
  allocationPct: number
  minConfidencePct: number
  minExpectedReturnPct: number
  stopLossPct: number
  takeProfitPct: number
}
