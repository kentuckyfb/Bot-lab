import { useEffect, useRef, useState } from 'react'
import { BarChart3, Bot, BrainCircuit, Braces, ChevronDown, CircleDot, Database, Eye, FastForward, FileUp, FlaskConical, Gauge, Info, Library, LoaderCircle, Pause, Play, Radio, RefreshCw, RotateCcw, Settings2, ShieldCheck, Sparkles, StepForward, Upload, X } from 'lucide-react'
import { PriceChart } from './components/PriceChart'
import { EquityChart } from './components/EquityChart'
import { ForecastChart } from './components/ForecastChart'
import { runBacktest } from './lib/backtest'
import { fetchBinanceCandles, fetchBinanceRange, fetchBinanceUsdtMarkets, generateDemoCandles, intervalMs, parseCsv, type BinanceMarket, type MarketMode } from './lib/data'
import { createForecast, createForecastFromPrices, scoreForecast, type ForecastModel, type ForecastOutput, type ForecastScore, type StartingState } from './lib/forecast'
import { builtInBots, defaultPythonCode, runBuiltInBot } from './lib/strategies'
import { runPythonBot, runPythonForecast } from './lib/pythonRunner'
import type { BacktestResult, BotDefinition, Candle, TestConfig } from './types'

type View = 'test' | 'paper' | 'bots'
type TestMode = 'forecast' | 'backtest' | 'replay'
type DataMode = 'demo' | 'binance' | 'csv'
type ForecastChoice = ForecastModel | 'custom-python'

const formatMoney = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 100 ? 2 : 0 }).format(value)
const formatUsdt = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)} USDT`
const formatPct = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
const trainingDaysByInterval: Record<string, number> = { '1m': 2, '5m': 7, '15m': 7, '30m': 14, '1h': 30 }
const forecastIntervals = ['1m', '5m', '15m', '30m', '1h'] as const

function defaultIntradayRanges(interval: string) {
  const now = new Date()
  const todayStartUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const step = intervalMs[interval] ?? intervalMs['15m']
  const trainingDays = trainingDaysByInterval[interval] ?? 7
  const predictionStart = todayStartUtc - 86_400_000
  const predictionEnd = todayStartUtc - step
  const trainingStart = predictionStart - trainingDays * 86_400_000
  const trainingEnd = predictionStart - step
  const inputValue = (time: number) => new Date(time).toISOString().slice(0, 16)
  return { trainingStart: inputValue(trainingStart), trainingEnd: inputValue(trainingEnd), predictionStart: inputValue(predictionStart), predictionEnd: inputValue(predictionEnd) }
}

const fallbackMarkets: BinanceMarket[] = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC'].map((baseAsset) => ({ symbol: `${baseAsset}USDT`, baseAsset, quoteAsset: 'USDT' }))
const popularMarketSymbols = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT'])

function MarketSelect({ value, onChange, mode = 'spot', disabled = false }: { value: string; onChange: (value: string) => void; mode?: MarketMode; disabled?: boolean }) {
  const [markets, setMarkets] = useState<BinanceMarket[]>(fallbackMarkets)
  useEffect(() => {
    let active = true
    setMarkets(fallbackMarkets)
    fetchBinanceUsdtMarkets(mode).then((items) => { if (active && items.length) setMarkets(items) }).catch(() => undefined)
    return () => { active = false }
  }, [mode])
  const popular = markets.filter((market) => popularMarketSymbols.has(market.symbol))
  const allOthers = markets.filter((market) => !popularMarketSymbols.has(market.symbol))
  return <div className="market-select-wrap"><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    <optgroup label="Popular">{popular.map((market) => <option value={market.symbol} key={market.symbol}>{market.baseAsset} / USDT</option>)}</optgroup>
    <optgroup label={`All Binance ${mode} USDT markets`}>{allOthers.map((market) => <option value={market.symbol} key={market.symbol}>{market.baseAsset} / USDT</option>)}</optgroup>
  </select></div>
}

const configHelp: Record<keyof TestConfig, { label: string; help: string }> = {
  initialCapital: { label: 'Starting virtual cash', help: 'Your simulated account balance in USDT' },
  feeBps: { label: 'Exchange fee (BPS)', help: 'Charged on each buy and sell; 10 = 0.10%' },
  slippageBps: { label: 'Price slippage (BPS)', help: 'Simulates receiving a worse price; 5 = 0.05%' },
  allocationPct: { label: 'Amount used per buy (%)', help: '20 means each buy uses 20% of available cash' },
  minConfidencePct: { label: 'Minimum confidence (%)', help: 'Ignore weaker buy predictions' },
  minExpectedReturnPct: { label: 'Minimum predicted gain (%)', help: 'Ignore predictions below this expected move' },
  stopLossPct: { label: 'Intraday stop loss (%)', help: 'Exit the day trade if price falls this much from the entry' },
  takeProfitPct: { label: 'Intraday profit target (%)', help: 'Exit the day trade if price rises this much from the entry' },
}

const metricHelp: Record<string, string> = {
  'Net return': 'How much the simulated account gained or lost after trading costs.',
  'Max drawdown': 'The largest fall from a previous account-value peak. Smaller is safer.',
  'Maximum drawdown': 'The largest fall from a previous account-value peak. Smaller is safer.',
  'Directional accuracy': 'How often the model correctly predicted whether price would rise or fall.',
  'Sharpe (est.)': 'A rough comparison of return against how unstable the returns were. Higher is generally better.',
  'Orders': 'The total number of simulated buy and sell orders.',
  'Scored predictions': 'Predictions that said up or down. Flat predictions are not counted.',
  'Simulated return': 'The percentage gained or lost by following the simulated trades.',
  'Simulated equity': 'Current virtual cash plus the current value of any coin still held.',
  'Average price error': 'The average percentage difference between predicted and actual prices. Lower is better.',
  'Account return': 'Total percentage gained or lost by the virtual account.',
  'Trades executed': 'How many simulated buys and sells actually occurred.',
  'Equity': 'Virtual cash plus the current value of the held coin.',
  'Cash': 'Virtual money not currently invested in the coin.',
  'Position': 'The amount of coin currently held by the paper account.',
  'Session P/L': 'Current virtual account value minus the 10,000 USDT paper-session starting balance.',
}

const botParamHelp: Record<string, string> = {
  fast: 'Number of recent candles used for the short-term average.',
  slow: 'Number of candles used for the longer-term average.',
  threshold: 'How far the averages must separate before producing a signal.',
  period: 'Number of candles used to calculate the indicator.',
  oversold: 'Below this RSI value, the bot considers the coin unusually weak and may buy.',
  overbought: 'Above this RSI value, the bot considers the coin unusually strong and may sell.',
  lookback: 'How many previous candles define the recent high and low range.',
  volumeFactor: 'How much higher volume must be than average before accepting a breakout.',
  buffer: 'How far price must move beyond the range before it counts as a breakout.',
  deviation: 'How far price must move from rolling VWAP before the scalp bot acts.',
  window: 'How many recent candles the custom bot uses for its calculation.',
}

function InfoTip({ text }: { text: string }) {
  return <span className="info-tip" tabIndex={0} aria-label={`Information: ${text}`} onClick={(event) => event.stopPropagation()}><Info size={11} /><span className="info-popover" role="tooltip">{text}</span></span>
}

function HelpLabel({ children, help }: { children: string; help: string }) {
  return <span className="help-label">{children}<InfoTip text={help} /></span>
}

function Metric({ label, value, tone = 'normal', note, help }: { label: string; value: string; tone?: 'normal' | 'good' | 'bad'; note?: string; help?: string }) {
  return <div className="metric"><span className="metric-label">{label}<InfoTip text={help ?? metricHelp[label] ?? note ?? `Explanation for ${label}.`} /></span><strong className={tone}>{value}</strong>{note && <small>{note}</small>}</div>
}

function App() {
  const [view, setView] = useState<View>('test')
  const [marketMode, setMarketMode] = useState<MarketMode>('spot')
  const [testMode, setTestMode] = useState<TestMode>('forecast')
  const [dataMode, setDataMode] = useState<DataMode>('demo')
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('15m')
  const [candles, setCandles] = useState<Candle[]>(() => generateDemoCandles())
  const [selectedBotId, setSelectedBotId] = useState('sma-cross')
  const [params, setParams] = useState<Record<string, number>>({ ...builtInBots[0].params })
  const [pythonCode, setPythonCode] = useState(defaultPythonCode)
  const [pythonParams, setPythonParams] = useState<Record<string, number>>({ window: 20, fast: 10, slow: 30 })
  const [config, setConfig] = useState<TestConfig>({ initialCapital: 1_000, feeBps: 10, slippageBps: 5, allocationPct: 25, minConfidencePct: 55, minExpectedReturnPct: 0.15, stopLossPct: 1, takeProfitPct: 2 })
  const [result, setResult] = useState<BacktestResult | null>(() => {
    const demo = generateDemoCandles(); const outputs = runBuiltInBot('sma-cross', demo, builtInBots[0].params)
    return runBacktest(demo, outputs, { initialCapital: 1_000, feeBps: 10, slippageBps: 5, allocationPct: 25, minConfidencePct: 55, minExpectedReturnPct: 0.15, stopLossPct: 1, takeProfitPct: 2 })
  })
  const [notice, setNotice] = useState('Demo dataset loaded · deterministic sample')
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [pythonBotName, setPythonBotName] = useState('Custom Python bot')
  const fileInput = useRef<HTMLInputElement>(null)
  const pythonFileInput = useRef<HTMLInputElement>(null)
  const selectedBot = builtInBots.find((bot) => bot.id === selectedBotId)

  const runTest = async () => {
    setBusy(true); setNotice('Running experiment…')
    try {
      const outputs = selectedBotId === 'python'
        ? await runPythonBot(pythonCode, candles, pythonParams)
        : runBuiltInBot(selectedBotId, candles, params)
      const next = runBacktest(candles, outputs, config); setResult(next)
      setNotice(`${selectedBotId === 'python' ? 'Python bot' : selectedBot?.name} completed · ${candles.length} bars · ${next.metrics.totalTrades} orders`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Experiment failed.') }
    finally { setBusy(false) }
  }

  const loadData = async () => {
    setBusy(true); setNotice('Loading market data…')
    try {
      const next = dataMode === 'demo' ? generateDemoCandles(500, interval) : await fetchBinanceCandles(symbol, interval, 500)
      setCandles(next); setResult(null); setNotice(`${dataMode === 'demo' ? 'Demo' : 'Binance'} · ${symbol} · ${interval} · ${next.length} bars loaded`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load data.') }
    finally { setBusy(false) }
  }

  const importCsv = async (file?: File) => {
    if (!file) return
    try { const next = parseCsv(await file.text()); setCandles(next); setResult(null); setDataMode('csv'); setNotice(`${file.name} · ${next.length} valid bars loaded`) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'CSV import failed.') }
  }

  const importPythonBot = async (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.py')) { setNotice('Choose a Python .py file.'); return }
    setPythonCode(await file.text()); setPythonBotName(file.name.replace(/\.py$/i, '')); setSelectedBotId('python'); setNotice(`${file.name} loaded · review the adapter contract, then run the experiment`)
  }

  const chooseBot = (bot: BotDefinition | 'python') => {
    if (bot === 'python') { setSelectedBotId('python'); return }
    setSelectedBotId(bot.id); setParams({ ...bot.params })
  }

  const renderSetting = (key: keyof TestConfig) => <label className="setting-row" key={key}>
    <div className="setting-copy"><div className="setting-name">{configHelp[key].label}<InfoTip text={configHelp[key].help} /></div><small>{configHelp[key].help}</small></div>
    <input type="number" value={config[key]} onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })} />
  </label>
  const amountPerBuy = config.initialCapital * config.allocationPct / 100
  const estimatedRoundTripCost = 2 * (config.feeBps + config.slippageBps) / 100

  return <div className="shell">
    <header className="app-topbar">
      <nav className="top-nav">
        <button className={view === 'test' && marketMode === 'spot' ? 'active' : ''} onClick={() => { setMarketMode('spot'); setView('test') }}><FlaskConical size={16} /> Spot</button>
        <button className={view === 'test' && marketMode === 'futures' ? 'active' : ''} onClick={() => { setMarketMode('futures'); setView('test') }}><Gauge size={16} /> Futures</button>
        <button className={view === 'paper' ? 'active' : ''} onClick={() => setView('paper')}><Radio size={16} /> Live paper</button>
        <button className={view === 'bots' ? 'active' : ''} onClick={() => setView('bots')}><Library size={16} /> Bots</button>
      </nav>
    </header>

    <main>
      {view === 'test' && testMode === 'backtest' && <>
        <header><div><span className="eyebrow">EXPERIMENT / 001</span><h1>Prediction workbench</h1><p>Load data, choose a bot, then test its entry and exit signals after costs.</p></div><button className="run-button" onClick={runTest} disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Play size={17} fill="currentColor" />} Run backtest <InfoTip text="Runs the selected bot across every loaded historical candle and simulates its trades." /></button></header>

        <section className="workflow-strip"><div><b>1</b><span><strong>Choose data</strong><small>Demo, Binance or CSV</small></span></div><i>→</i><div><b>2</b><span><strong>Choose a bot</strong><small>Built-in or Python file</small></span></div><i>→</i><div><b>3</b><span><strong>Run and review</strong><small>Signals, risk and returns</small></span></div><button onClick={() => setShowSettings(true)}><Settings2 size={14} /> Entry & exit rules</button></section>

        <section className="source-bar">
          <div className="segmented">
            <button className={dataMode === 'demo' ? 'active' : ''} onClick={() => setDataMode('demo')}><Sparkles size={15} /> Demo <InfoTip text="Generated sample prices for learning the interface. They are not real market data." /></button>
            <button className={dataMode === 'binance' ? 'active' : ''} onClick={() => setDataMode('binance')}><Database size={15} /> Binance <InfoTip text="Downloads recent public candles for the selected market from Binance." /></button>
            <button className={dataMode === 'csv' ? 'active' : ''} onClick={() => fileInput.current?.click()}><FileUp size={15} /> CSV <InfoTip text="Loads historical open, high, low, close and volume data from your own file." /></button>
          </div>
          <div className="source-fields">
            <label><HelpLabel help="The trading pair to test. BTCUSDT means buying Bitcoin using virtual USDT.">MARKET</HelpLabel><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} disabled={dataMode === 'csv'} /></label>
            <label><HelpLabel help="The duration represented by each candle. For example, 1h means one candle per hour.">INTERVAL</HelpLabel><select value={interval} onChange={(event) => setInterval(event.target.value)}><option>1m</option><option>5m</option><option>15m</option><option>1h</option><option>4h</option><option>1d</option></select><ChevronDown size={14} /></label>
            <button className="load-button" onClick={dataMode === 'csv' ? () => fileInput.current?.click() : loadData}>{dataMode === 'csv' ? <Upload size={16} /> : <RefreshCw size={16} />} {dataMode === 'csv' ? 'Choose file' : 'Load data'} <InfoTip text="Loads the selected source into the chart. Loading new data clears the previous result." /></button>
            <input ref={fileInput} className="hidden" type="file" accept=".csv,.tsv,.txt" onChange={(event) => importCsv(event.target.files?.[0])} />
          </div>
        </section>

        <div className="notice"><CircleDot size={14} /> {notice}</div>

        <section className="workspace-grid">
          <div className="chart-card card">
            <div className="card-title"><div><h2>{symbol.replace('USDT', ' / USDT')}</h2><span>Candles <i /> <em>Bot prediction</em> <i className="trade-dot" /> Trades</span></div><div className="price-readout"><strong>{formatMoney(candles.at(-1)?.close ?? 0)}</strong><span>{candles.length} bars</span></div></div>
            <PriceChart candles={candles} result={result} />
          </div>
          <aside className="bot-panel card">
            <div className="card-title compact"><div><span className="eyebrow">ACTIVE MODEL</span><h2>{selectedBotId === 'python' ? pythonBotName : selectedBot?.name}</h2></div><Bot size={20} /></div>
            <div className="bot-picker">
              {[...builtInBots, { id: 'python', name: 'Custom Python', description: 'Runs code that follows the SignalForge bot contract.', category: 'Code', source: 'python', params: {} } as BotDefinition].map((bot) => <button key={bot.id} className={selectedBotId === bot.id ? 'selected' : ''} onClick={() => chooseBot(bot.id === 'python' ? 'python' : bot)}><span>{bot.name} <InfoTip text={bot.description || 'Select this strategy for testing.'} /></span><small>{bot.category}</small></button>)}
            </div>
            {selectedBotId !== 'python' ? <div className="parameter-list">
              <div className="section-label">PARAMETERS <InfoTip text="Values that control how sensitive the selected bot is and when it creates signals." /></div>
              {Object.entries(params).map(([key, value]) => <label key={key}><HelpLabel help={botParamHelp[key] ?? 'A numeric setting used by this bot.'}>{key.replace(/([A-Z])/g, ' $1')}</HelpLabel><input type="number" step={Math.abs(value) < 1 ? .001 : 1} value={value} onChange={(event) => setParams({ ...params, [key]: Number(event.target.value) })} /></label>)}
              <p className="bot-description">{selectedBot?.description}</p>
            </div> : <div className="python-editor">
              <div className="section-label"><span>PYTHON · PYODIDE <InfoTip text="Runs a self-contained Python bot inside the browser without placing real orders." /></span><Braces size={15} /></div>
              <button className="import-bot" onClick={() => pythonFileInput.current?.click()}><Upload size={14} /> Load .py bot file</button>
              <textarea value={pythonCode} onChange={(event) => setPythonCode(event.target.value)} spellCheck={false} />
              {Object.entries(pythonParams).map(([key, value]) => <label key={key}><HelpLabel help={botParamHelp[key] ?? 'A numeric value passed into the Python bot.'}>{key}</HelpLabel><input type="number" value={value} onChange={(event) => setPythonParams({ ...pythonParams, [key]: Number(event.target.value) })} /></label>)}
              <small>First run downloads the Python runtime. Network and local files are not provided to the bot.</small>
            </div>}
            <div className="execution-note"><Gauge size={16} /><div><b>Next-open execution</b><span>{config.feeBps} bps fee + {config.slippageBps} bps slippage</span></div></div>
          </aside>
        </section>

        {result && <Results result={result} config={config} />}
      </>}
      {view === 'test' && <ForecastLab marketMode={marketMode} config={config} onOpenSettings={() => setShowSettings(true)} pythonCode={pythonCode} pythonParams={pythonParams} pythonBotName={pythonBotName} selectedBotId={selectedBotId} />}
      {view === 'test' && testMode === 'replay' && <ReplayLab botId={selectedBotId} bot={selectedBot} params={params} config={config} onOpenSettings={() => setShowSettings(true)} />}
      {view === 'paper' && <PaperLab marketMode={marketMode} symbol={symbol} interval={interval} bot={selectedBot ?? builtInBots[0]} config={config} />}
      {view === 'bots' && <BotLibrary selectedBotId={selectedBotId} pythonBotName={pythonBotName} pythonCode={pythonCode} onImport={() => pythonFileInput.current?.click()} onChoose={(bot) => { chooseBot(bot); setView('test'); setTestMode('forecast') }} onPython={() => { chooseBot('python'); setView('test'); setTestMode('forecast') }} />}
    </main>

    <input ref={pythonFileInput} className="hidden" type="file" accept=".py,text/x-python" onChange={(event) => importPythonBot(event.target.files?.[0])} />

    {showSettings && <div className="modal-backdrop" onMouseDown={() => setShowSettings(false)}><div className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={() => setShowSettings(false)} aria-label="Close settings"><X size={20} /></button>
      <div className="settings-head"><span className="eyebrow">RISK SETTINGS</span><h2>Money & risk</h2></div>
      <div className="settings-summary">
        <div><span>VIRTUAL ACCOUNT</span><b>{formatUsdt(config.initialCapital)}</b></div>
        <div><span>AMOUNT PER TRADE</span><b>{formatUsdt(amountPerBuy)}</b></div>
        <div><span>BUY + SELL COST</span><b>{estimatedRoundTripCost.toFixed(2)}%</b></div>
      </div>
      <div className="settings-columns">
        <section className="settings-group"><h3>Account & costs</h3>{renderSetting('initialCapital')}{renderSetting('allocationPct')}{renderSetting('feeBps')}{renderSetting('slippageBps')}</section>
        <section className="settings-group"><h3>Entry & exit rules</h3>{renderSetting('minConfidencePct')}{renderSetting('minExpectedReturnPct')}{renderSetting('stopLossPct')}{renderSetting('takeProfitPct')}</section>
      </div>
      <div className="settings-footer"><button className="run-button" onClick={() => setShowSettings(false)}>Save changes</button></div>
    </div></div>}
  </div>
}

type ReplayRecord = {
  output: ReturnType<typeof runBuiltInBot>[number]
  actual: Candle
  correct: boolean | null
}

function ForecastLab({ marketMode, config, onOpenSettings, pythonCode, pythonParams, pythonBotName, selectedBotId }: { marketMode: MarketMode; config: TestConfig; onOpenSettings: () => void; pythonCode: string; pythonParams: Record<string, number>; pythonBotName: string; selectedBotId: string }) {
  const initialRanges = useRef(defaultIntradayRanges('15m')).current
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('15m')
  const [leverage, setLeverage] = useState(3)
  const [trainingStart, setTrainingStart] = useState(initialRanges.trainingStart)
  const [trainingEnd, setTrainingEnd] = useState(initialRanges.trainingEnd)
  const [predictionStart, setPredictionStart] = useState(initialRanges.predictionStart)
  const [predictionEnd, setPredictionEnd] = useState(initialRanges.predictionEnd)
  const [model, setModel] = useState<ForecastChoice>('trend')
  const [startingState, setStartingState] = useState<StartingState>('cash')
  const [training, setTraining] = useState<Candle[]>([])
  const [actual, setActual] = useState<Candle[]>([])
  const [forecast, setForecast] = useState<ForecastOutput | null>(null)
  const [score, setScore] = useState<ForecastScore | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [intervalRuns, setIntervalRuns] = useState<Record<string, { training: Candle[]; actual: Candle[]; forecast: ForecastOutput; score: ForecastScore | null; ranges: ReturnType<typeof defaultIntradayRanges> }>>({})
  const tradeAmount = config.initialCapital * config.allocationPct / 100
  const clearGeneratedTests = () => { setIntervalRuns({}); setForecast(null); setScore(null); setRevealed(false); setMessage('') }

  const changeInterval = (nextInterval: string) => {
    const saved = intervalRuns[nextInterval]
    if (saved) {
      setInterval(nextInterval); setTrainingStart(saved.ranges.trainingStart); setTrainingEnd(saved.ranges.trainingEnd); setPredictionStart(saved.ranges.predictionStart); setPredictionEnd(saved.ranges.predictionEnd)
      setTraining(saved.training); setActual(saved.actual); setForecast(saved.forecast); setScore(saved.score); setRevealed(Boolean(saved.score)); setMessage(`Showing ${nextInterval} results. All candle sizes were created in the same test run.`)
      return
    }
    const ranges = defaultIntradayRanges(nextInterval)
    setInterval(nextInterval); setTrainingStart(ranges.trainingStart); setTrainingEnd(ranges.trainingEnd); setPredictionStart(ranges.predictionStart); setPredictionEnd(ranges.predictionEnd)
    setForecast(null); setScore(null); setRevealed(false); setMessage('')
  }

  useEffect(() => {
    const mapped: ForecastChoice = selectedBotId === 'mean-reversion' || selectedBotId === 'vwap-scalp' ? 'mean-reversion' : selectedBotId === 'breakout' ? 'momentum' : selectedBotId === 'python' && pythonCode.includes('forecast_prices') ? 'custom-python' : 'trend'
    setModel(mapped); setIntervalRuns({}); setForecast(null); setScore(null); setRevealed(false)
  }, [selectedBotId, pythonCode])

  useEffect(() => {
    setSymbol('BTCUSDT'); setStartingState('cash'); setForecast(null); setScore(null); setRevealed(false); setIntervalRuns({}); setMessage('')
  }, [marketMode])

  const generate = async () => {
    setBusy(true); setMessage('Running all 5 candle sizes…')
    try {
      const asUtc = (value: string) => Date.parse(`${value}${value.endsWith('Z') ? '' : 'Z'}`)
      const predictionStartTime = asUtc(predictionStart)
      const predictionEndTime = asUtc(predictionEnd)
      if (predictionEndTime - predictionStartTime > 86_400_000) throw new Error('For a day-trading test, keep the prediction session to 24 hours or less.')
      const nextRuns: Record<string, { training: Candle[]; actual: Candle[]; forecast: ForecastOutput; score: ForecastScore | null; ranges: ReturnType<typeof defaultIntradayRanges> }> = {}
      for (const size of forecastIntervals) {
        setMessage(`Running ${size} candles… ${Object.keys(nextRuns).length + 1} of ${forecastIntervals.length}`)
        const step = intervalMs[size]
        const trainingEndTime = predictionStartTime - step
        const trainingStartTime = predictionStartTime - (trainingDaysByInterval[size] ?? 7) * 86_400_000
        const toInput = (time: number) => new Date(time).toISOString().slice(0, 16)
        const ranges = { trainingStart: toInput(trainingStartTime), trainingEnd: toInput(trainingEndTime), predictionStart, predictionEnd }
        const downloaded = await fetchBinanceRange(symbol, size, ranges.trainingStart, predictionEnd, 5000, marketMode)
        const nextTraining = downloaded.filter((candle) => candle.time >= trainingStartTime && candle.time <= trainingEndTime)
        const nextActual = downloaded.filter((candle) => candle.time >= predictionStartTime && candle.time <= predictionEndTime)
        if (nextTraining.length < 100) throw new Error(`${size} test needs at least 100 training candles.`)
        const futureTimes: number[] = []
        for (let time = predictionStartTime; time <= predictionEndTime && futureTimes.length < 1500; time += step) futureTimes.push(time)
        const nextForecast = model === 'custom-python'
          ? createForecastFromPrices(nextTraining, futureTimes, await runPythonForecast(pythonCode, nextTraining, futureTimes, pythonParams), config.minExpectedReturnPct, config.minConfidencePct, startingState, marketMode)
          : createForecast(nextTraining, futureTimes, model, config.minExpectedReturnPct, config.minConfidencePct, startingState, marketMode)
        const comparable = nextActual.filter((candle) => nextForecast.points.some((point) => point.time === candle.time))
        const nextScore = comparable.length ? scoreForecast(nextTraining, comparable, nextForecast, config, startingState, { marketMode, leverage }) : null
        nextRuns[size] = { training: nextTraining, actual: nextActual, forecast: nextForecast, score: nextScore, ranges }
      }
      setIntervalRuns(nextRuns)
      const selected = nextRuns[interval]
      setTrainingStart(selected.ranges.trainingStart); setTrainingEnd(selected.ranges.trainingEnd); setTraining(selected.training); setActual(selected.actual); setForecast(selected.forecast); setScore(selected.score); setRevealed(Boolean(selected.score))
      setMessage('All 5 candle-size tests are ready. Switch tabs to compare them.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create the forecasts.') }
    finally { setBusy(false) }
  }

  const actionLabel = forecast?.action === 'BUY & HOLD' ? marketMode === 'futures' ? 'OPEN LONG' : 'BUY' : forecast?.action === 'OPEN SHORT' ? 'OPEN SHORT' : forecast?.action === 'HOLD CASH' || forecast?.action === 'NO TRADE' ? 'DO NOTHING' : forecast?.action === 'HOLD COIN' ? 'KEEP HOLDING' : 'SELL'

  return <>
    <section className="forecast-setup">
      <div className="forecast-block card"><div className="forecast-block-title"><div><b>Training data <InfoTip text="Prices the model may study before the test period." /></b><small>Previous {trainingDaysByInterval[interval] ?? 7} days</small></div></div><div className="date-fields"><label><HelpLabel help="UTC date and time of the first training candle.">FROM (UTC)</HelpLabel><input type="datetime-local" value={trainingStart} onChange={(event) => setTrainingStart(event.target.value)} /></label><label><HelpLabel help="UTC date and time of the last candle visible to the bot.">TO (UTC)</HelpLabel><input type="datetime-local" value={trainingEnd} onChange={(event) => setTrainingEnd(event.target.value)} /></label></div></div>
      <div className="forecast-block card"><div className="forecast-block-title"><div><b>Test period <InfoTip text="Hidden prices used to score the model after it makes a prediction." /></b><small>Yesterday</small></div></div><div className="date-fields"><label><HelpLabel help="UTC date and time when the test starts.">START (UTC)</HelpLabel><input type="datetime-local" value={predictionStart} onChange={(event) => { setPredictionStart(event.target.value); clearGeneratedTests() }} /></label><label><HelpLabel help="UTC date and time when the test ends.">END (UTC)</HelpLabel><input type="datetime-local" value={predictionEnd} onChange={(event) => { setPredictionEnd(event.target.value); clearGeneratedTests() }} /></label></div></div>
    </section>

    <section className="forecast-options card">
      <label><HelpLabel help={`Choose a Binance ${marketMode} USDT market.`}>MARKET</HelpLabel><MarketSelect value={symbol} onChange={(value) => { setSymbol(value); clearGeneratedTests() }} mode={marketMode} /></label>
      <div className="candle-size-field"><HelpLabel help="Run once, then switch between all five candle-size results.">RESULT SIZE</HelpLabel><div className="candle-tabs" role="tablist" aria-label="Candle size results">{forecastIntervals.map((size) => <button type="button" role="tab" aria-selected={interval === size} className={`${interval === size ? 'active' : ''} ${intervalRuns[size] ? 'ready' : ''}`} onClick={() => changeInterval(size)} key={size}>{size}</button>)}</div></div>
      <label><HelpLabel help="Short-horizon forecast style used by the selected day-trading bot.">DAY-TRADE MODEL</HelpLabel><select value={model} onChange={(event) => { setModel(event.target.value as ForecastChoice); clearGeneratedTests() }}><option value="trend">Intraday trend</option><option value="momentum">Momentum breakout</option><option value="mean-reversion">Pullback / VWAP reversion</option>{pythonCode.includes('forecast_prices') && <option value="custom-python">{pythonBotName} (Python)</option>}</select></label>
      {marketMode === 'spot' ? <label><HelpLabel help="Cash only tests a new buy. Already holding tests whether to keep or sell a position.">STARTING POSITION</HelpLabel><select value={startingState} onChange={(event) => { setStartingState(event.target.value as StartingState); clearGeneratedTests() }}><option value="cash">No position</option><option value="holding">Holding coin</option></select></label> : <label><HelpLabel help="Leverage multiplies both profit and loss. This remains a paper simulation.">LEVERAGE</HelpLabel><select value={leverage} onChange={(event) => { setLeverage(Number(event.target.value)); clearGeneratedTests() }}>{[1, 2, 3, 5, 10].map((value) => <option value={value} key={value}>{value}x</option>)}</select></label>}
    </section>
    <section className="risk-strip card">
      <div><span>ACCOUNT</span><b>{formatUsdt(config.initialCapital)}</b></div>
      <div><span>{marketMode === 'futures' ? 'MARGIN / POSITION' : 'TRADE SIZE'}</span><b>{marketMode === 'futures' ? `${formatUsdt(tradeAmount)} / ${formatUsdt(tradeAmount * leverage)}` : `${config.allocationPct}% · ${formatUsdt(tradeAmount)}`}</b></div>
      <div className="risk-loss"><span>STOP LOSS</span><b>-{config.stopLossPct}%</b></div>
      <div className="risk-profit"><span>TAKE PROFIT</span><b>+{config.takeProfitPct}%</b></div>
      <div><span>FEE / SLIPPAGE</span><b>{(config.feeBps / 100).toFixed(2)}% / {(config.slippageBps / 100).toFixed(2)}%</b></div>
      <div className="risk-actions"><button onClick={onOpenSettings}><Settings2 size={14} /> Edit risk</button><button className="run-button" onClick={generate} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <BrainCircuit size={16} />} Run all 5</button></div>
    </section>
    {message && <div className="notice"><CircleDot size={14} /> {message}</div>}

    {forecast ? <>
      <section className="forecast-decision card">
        <div className={`forecast-action ${forecast.action.includes('BUY') ? 'buy' : forecast.action.includes('SELL') || forecast.action === 'OPEN SHORT' ? 'sell' : 'hold'}`}><span>BOT ACTION</span><strong>{actionLabel}</strong></div>
        <div><span>Expected move <InfoTip text="How much the model expects price to change from the training close to the prediction end." /></span><b>{formatPct(forecast.expectedReturn)}</b></div>
        <div><span>Model confidence <InfoTip text="A model-strength score, not a guaranteed probability of success." /></span><b>{(forecast.confidence * 100).toFixed(0)}%</b></div>
      </section>

      <section className="forecast-chart-card card"><div className="card-title"><div><h2>{symbol}: forecast versus actual</h2><span><i /> Purple forecast {revealed && <><i className="actual-key" /> Blue actual</>}</span></div><div className="forecast-last"><span>Predicted end</span><strong>{formatUsdt(forecast.points.at(-1)!.predicted)}</strong></div></div><ForecastChart training={training} actual={actual} forecast={forecast} score={score} revealed={revealed} /></section>

      {!revealed ? <section className="hidden-result card"><Eye size={22} /><div><b>Actual prices hidden</b><span>Reveal them to score the test.</span></div></section> : score && <section className={`result-center simple-result card ${score.profitLoss > 0 ? 'success' : score.profitLoss < 0 ? 'failure' : 'neutral'}`}>
        <div className="simple-result-head">
          <div><span className="eyebrow">TEST RESULT</span><h2 className={score.directionCorrect ? 'positive' : score.directionCorrect === false ? 'negative' : ''}>{score.directionCorrect === null ? 'FLAT FORECAST' : score.directionCorrect ? 'FORECAST WAS RIGHT' : 'FORECAST WAS WRONG'}</h2></div>
          <div className="result-profit"><span>PROFIT / LOSS <InfoTip text="How much the virtual account gained or lost after fees and slippage." /></span><strong>{score.profitLoss >= 0 ? '+' : ''}{formatUsdt(score.profitLoss)}</strong><small>{formatPct(score.returnPct)} return</small></div>
        </div>
        <div className="simple-score-grid">
          <div><span>Accuracy <InfoTip text="How often the forecast got each candle's up or down direction right." /></span><b>{formatPct(score.directionAccuracy).replace('+', '')}</b></div>
          <div><span>Error margin <InfoTip text="Average difference between predicted and actual prices. Lower is better." /></span><b>{formatPct(score.meanAbsolutePctError).replace('+', '')}</b></div>
          <div><span>Ending balance</span><b>{formatUsdt(score.finalEquity)}</b></div>
          <div><span>Market moved</span><b className={score.actualReturn >= 0 ? 'positive' : 'negative'}>{formatPct(score.actualReturn)}</b></div>
        </div>
        <div className="trade-action-panel"><div className="trade-action-title"><h3>Buy and sell actions</h3><span>{score.trades.length} action{score.trades.length === 1 ? '' : 's'}</span></div><div className="trade-action-list">{score.trades.length ? score.trades.map((trade, index) => <div key={`${trade.time}-${index}`} className={`trade-action-card ${trade.side}`}><strong>{trade.side === 'buy' ? 'BUY' : 'SELL'}</strong><div><span>Price</span><b>{formatUsdt(trade.price)}</b></div><div><span>Amount</span><b>{formatUsdt(trade.quantity * trade.price)}</b></div><time>{new Date(trade.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC</time></div>) : <div className="no-trade-action"><b>NO TRADE</b><span>The bot did not find a safe entry.</span></div>}</div></div>
      </section>}
    </> : <section className="forecast-welcome card"><BrainCircuit size={30} /><h2>Ready to test</h2><p>Set the market, dates and model, then run the test.</p></section>}
  </>
}

function ReplayLab({ bot, params, config, onOpenSettings }: { botId: string; bot?: BotDefinition; params: Record<string, number>; config: TestConfig; onOpenSettings: () => void }) {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('4h')
  const [startDate, setStartDate] = useState('2024-01-01')
  const [endDate, setEndDate] = useState('2024-06-30')
  const [replayBotId, setReplayBotId] = useState(bot?.id ?? 'sma-cross')
  const [replayParams, setReplayParams] = useState<Record<string, number>>(bot ? { ...params } : { ...builtInBots[0].params })
  const [allCandles, setAllCandles] = useState<Candle[]>([])
  const [replayStart, setReplayStart] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [records, setRecords] = useState<ReplayRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Choose a market and date range, then load the replay.')
  const activeBot = builtInBots.find((item) => item.id === replayBotId) ?? builtInBots[0]
  const visibleCandles = allCandles.slice(0, cursor)
  const latestRecord = records.at(-1)
  const finished = Boolean(allCandles.length && cursor >= allCandles.length)

  const replayResult = records.length ? (() => {
    const simulationCandles = allCandles.slice(Math.max(0, replayStart - 1), cursor)
    const recordByTime = new Map(records.map((record) => [record.output.time, record.output]))
    const simulationOutputs = simulationCandles.map((candle) => recordByTime.get(candle.time) ?? { time: candle.time, predictedPrice: candle.close, direction: 'flat' as const, confidence: 0.5, expectedReturn: 0, signal: 'hold' as const })
    return runBacktest(simulationCandles, simulationOutputs, config)
  })() : null

  const scored = records.filter((record) => record.correct !== null)
  const accuracy = scored.length ? scored.filter((record) => record.correct).length / scored.length : 0
  const progress = allCandles.length > replayStart ? (cursor - replayStart) / (allCandles.length - replayStart) * 100 : 0

  const loadReplay = async () => {
    setBusy(true); setMessage('Downloading historical candles from Binance…')
    try {
      const downloaded = await fetchBinanceRange(symbol, interval, startDate, endDate)
      const requiredWarmup = Math.max(60, Math.round(replayParams.slow ?? replayParams.lookback ?? replayParams.period ?? 30) + 5)
      const start = Math.min(requiredWarmup, downloaded.length - 2)
      setAllCandles(downloaded); setReplayStart(start); setCursor(start); setRecords([])
      setMessage(`${downloaded.length} candles loaded. The first ${start} are warm-up only; future candles are now hidden.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load the replay.') }
    finally { setBusy(false) }
  }

  const makeRecord = (decisionIndex: number, outputs?: ReturnType<typeof runBuiltInBot>): ReplayRecord => {
    const output = (outputs ?? runBuiltInBot(replayBotId, allCandles.slice(0, decisionIndex + 1), replayParams))[decisionIndex] ?? (outputs ?? [])[decisionIndex]
    const actual = allCandles[decisionIndex + 1]
    const movedUp = actual.close > allCandles[decisionIndex].close
    const correct = output.direction === 'flat' ? null : (output.direction === 'up') === movedUp
    return { output, actual, correct }
  }

  const revealNext = () => {
    if (!allCandles.length || cursor >= allCandles.length) return
    const record = makeRecord(cursor - 1)
    setRecords((current) => [...current.filter((item) => item.output.time !== record.output.time), record])
    setCursor((current) => current + 1)
    setMessage(`Revealed ${new Date(record.actual.time).toLocaleString()}. The prediction was ${record.correct === null ? 'flat' : record.correct ? 'correct' : 'incorrect'}.`)
  }

  const runRemaining = () => {
    if (!allCandles.length || cursor >= allCandles.length) return
    setBusy(true)
    window.setTimeout(() => {
      const causalOutputs = runBuiltInBot(replayBotId, allCandles, replayParams)
      const nextRecords: ReplayRecord[] = []
      for (let decisionIndex = cursor - 1; decisionIndex < allCandles.length - 1; decisionIndex++) nextRecords.push(makeRecord(decisionIndex, causalOutputs))
      const merged = new Map(records.map((record) => [record.output.time, record])); nextRecords.forEach((record) => merged.set(record.output.time, record))
      setRecords([...merged.values()].sort((a, b) => a.output.time - b.output.time)); setCursor(allCandles.length); setBusy(false); setMessage(`Replay complete · ${allCandles.length - replayStart} candles revealed without changing the bot.`)
    }, 0)
  }

  const resetReplay = () => { setCursor(replayStart); setRecords([]); setMessage('Replay reset. Future candles are hidden again.') }
  const changeBot = (id: string) => { const next = builtInBots.find((item) => item.id === id) ?? builtInBots[0]; setReplayBotId(next.id); setReplayParams({ ...next.params }); setCursor(replayStart); setRecords([]); setMessage(`${next.name} selected. Replay results were reset.`) }

  return <>
    <header><div><span className="eyebrow">WALK-FORWARD / NO PEEKING</span><h1>Historical replay</h1><p>Make a prediction at the cutoff, reveal the next candle, then score and simulate it.</p></div><button className="run-button" onClick={loadReplay} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />} Load replay <InfoTip text="Downloads the selected historical range, shows warm-up candles and hides the remaining future candles." /></button></header>
    <section className="replay-setup card">
      <label><HelpLabel help="The coin pair whose past prices will be replayed.">MARKET</HelpLabel><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} /></label>
      <label><HelpLabel help="Duration of each replay candle. 1h means one historical hour per step.">INTERVAL</HelpLabel><select value={interval} onChange={(event) => setInterval(event.target.value)}><option>15m</option><option>1h</option><option>4h</option><option>1d</option></select></label>
      <label><HelpLabel help="First date downloaded for the replay and indicator warm-up.">START DATE</HelpLabel><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label><HelpLabel help="Last date the replay is allowed to reveal.">END DATE</HelpLabel><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <label><HelpLabel help="The rule-based strategy making each buy, sell or hold decision.">BOT</HelpLabel><select value={replayBotId} onChange={(event) => changeBot(event.target.value)}>{builtInBots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button onClick={onOpenSettings}><Settings2 size={15} /> Risk rules <InfoTip text="Opens the virtual money, transaction-cost and automatic exit settings." /></button>
    </section>
    <div className="notice"><CircleDot size={14} /> {message}</div>

    {allCandles.length ? <>
      <section className="replay-status card">
        <div><span>CURRENT CUTOFF <InfoTip text="The latest candle currently visible to the bot. Later candles remain hidden." /></span><strong>{new Date(visibleCandles.at(-1)!.time).toLocaleString()}</strong><small>The bot cannot see anything after this candle.</small></div>
        <div className="replay-progress"><span><b>{records.length}</b> of {allCandles.length - replayStart} test candles revealed</span><div><i style={{ width: `${Math.min(100, progress)}%` }} /></div></div>
        <div className="replay-actions"><button onClick={resetReplay}><RotateCcw size={15} /> Reset <InfoTip text="Returns to the original cutoff and hides all revealed test candles again." /></button><button onClick={revealNext} disabled={finished || busy}><StepForward size={15} /> Reveal next candle <InfoTip text="Records the bot prediction first, then exposes exactly one future candle and scores it." /></button><button className="primary" onClick={runRemaining} disabled={finished || busy}><FastForward size={15} /> Run entire replay <InfoTip text="Repeats prediction then reveal through every remaining candle without changing the bot." /></button></div>
      </section>

      <section className="replay-grid">
        <div className="card replay-chart"><div className="card-title"><div><h2>{symbol} · visible history only</h2><span><Eye size={12} /> {visibleCandles.length} visible / {allCandles.length} total candles</span></div><strong>{formatMoney(visibleCandles.at(-1)?.close ?? 0)}</strong></div><PriceChart candles={visibleCandles} result={replayResult} /></div>
        <aside className="card reveal-card">
          <span className="eyebrow">PREDICTION VS ACTUAL <InfoTip text="Compares the prediction recorded before reveal with what the next candle actually did." /></span>
          {latestRecord ? <><div className={`reveal-verdict ${latestRecord.correct === null ? 'flat' : latestRecord.correct ? 'correct' : 'wrong'}`}>{latestRecord.correct === null ? 'FLAT PREDICTION' : latestRecord.correct ? 'CORRECT DIRECTION' : 'WRONG DIRECTION'}</div><dl><div><dt>Bot predicted</dt><dd>{latestRecord.output.direction.toUpperCase()} · {formatMoney(latestRecord.output.predictedPrice)}</dd></div><div><dt>Actual next close</dt><dd>{formatMoney(latestRecord.actual.close)}</dd></div><div><dt>Signal</dt><dd>{latestRecord.output.signal.toUpperCase()}</dd></div><div><dt>Confidence</dt><dd>{(latestRecord.output.confidence * 100).toFixed(0)}%</dd></div></dl></> : <div className="reveal-empty"><StepForward size={24} /><b>Nothing revealed yet</b><span>Click “Reveal next candle” to lock a prediction and expose one future candle.</span></div>}
        </aside>
      </section>

      <section className="replay-score">
        <Metric label="Scored predictions" value={String(scored.length)} note="Flat predictions excluded" />
        <Metric label="Direction accuracy" value={scored.length ? formatPct(accuracy).replace('+', '') : '—'} note="Walk-forward only" />
        <Metric label="Simulated return" value={replayResult ? formatPct(replayResult.metrics.netReturn) : '—'} tone={replayResult && replayResult.metrics.netReturn >= 0 ? 'good' : 'normal'} note="After costs" />
        <Metric label="Simulated equity" value={replayResult ? formatMoney(replayResult.metrics.finalEquity) : '—'} note={`Started at ${formatMoney(config.initialCapital)}`} />
        <Metric label="Maximum drawdown" value={replayResult ? formatPct(replayResult.metrics.maxDrawdown) : '—'} tone={replayResult ? 'bad' : 'normal'} note="Peak-to-trough" />
      </section>
    </> : <section className="replay-welcome card"><BarChart3 size={29} /><h2>No future data will be shown</h2><p>Load a date range. SignalForge keeps an initial warm-up window visible, hides everything after the cutoff, and scores each prediction only when you reveal the next candle.</p></section>}
  </>
}

function Results({ result, config }: { result: BacktestResult; config: TestConfig }) {
  const m = result.metrics
  const latest = result.outputs.at(-1)
  const passesEntry = Boolean(latest && latest.signal === 'buy' && latest.confidence * 100 >= config.minConfidencePct && latest.expectedReturn * 100 >= config.minExpectedReturnPct)
  const decision = latest?.signal === 'sell' ? 'SELL / EXIT' : passesEntry ? 'BUY CANDIDATE' : 'WAIT'
  const decisionTone = decision.startsWith('BUY') ? 'buy' : decision.startsWith('SELL') ? 'sell' : 'wait'
  return <section className="results">
    <div className="results-head"><div><span className="eyebrow">RESULTS</span><h2>What survived the simulation</h2></div><span className="badge">BACKTEST · NOT LIVE</span></div>
    {latest && <div className="decision-card card"><div className={`decision-signal ${decisionTone}`}><span>LATEST MODEL DECISION <InfoTip text="The action produced after applying the model signal and your minimum entry rules." /></span><strong>{decision}</strong></div><div><span>Model signal <InfoTip text="Raw buy, sell or hold output before account and risk rules are applied." /></span><b>{latest.signal.toUpperCase()}</b></div><div><span>Confidence <InfoTip text="Model-strength score. It is not a guaranteed probability of success." /></span><b>{(latest.confidence * 100).toFixed(0)}%</b><small>Minimum {config.minConfidencePct}%</small></div><div><span>Expected return <InfoTip text="Price change the model expects for its next prediction step." /></span><b>{formatPct(latest.expectedReturn)}</b><small>Minimum +{config.minExpectedReturnPct}%</small></div><p>{decision === 'WAIT' ? 'The latest prediction does not pass your entry rules. No new position should be simulated.' : decision.startsWith('BUY') ? 'The model signal passes your configured entry filters. Check risk and market context before acting.' : 'The model currently signals an exit. Existing simulated positions close on the next candle open.'}</p></div>}
    <div className="metric-grid">
      <Metric label="Net return" value={formatPct(m.netReturn)} tone={m.netReturn >= 0 ? 'good' : 'bad'} note={`vs ${formatPct(m.benchmarkReturn)} buy & hold`} />
      <Metric label="Max drawdown" value={formatPct(m.maxDrawdown)} tone="bad" note="Peak-to-trough" />
      <Metric label="Directional accuracy" value={formatPct(m.directionalAccuracy).replace('+', '')} note="Non-flat predictions" />
      <Metric label="Sharpe (est.)" value={m.sharpe.toFixed(2)} note="Frequency approximation" />
      <Metric label="Orders" value={String(m.totalTrades)} note={`${formatMoney(m.totalFees)} fees`} />
    </div>
    <div className="results-grid">
      <div className="card equity-card"><div className="card-title"><div><h2>Portfolio equity</h2><span>Strategy versus passive benchmark</span></div><strong>{formatMoney(m.finalEquity)}</strong></div><EquityChart result={result} /></div>
      <div className="card ledger"><div className="card-title"><div><h2>Decision ledger</h2><span>Most recent simulated orders</span></div></div><div className="ledger-list">{result.trades.length ? result.trades.slice(-7).reverse().map((trade, index) => <div key={`${trade.time}-${index}`}><span className={`side ${trade.side}`}>{trade.side}</span><div><b>{trade.quantity.toFixed(5)} BTC</b><small>{new Date(trade.time).toLocaleString()}</small></div><div className="ledger-price"><b>{formatMoney(trade.price)}</b><small>{formatMoney(trade.fee)} fee</small></div></div>) : <div className="empty">No trades generated by these settings.</div>}</div></div>
    </div>
  </section>
}

function PaperLab({ marketMode, symbol: initialSymbol, interval: initialInterval, bot, config }: { marketMode: MarketMode; symbol: string; interval: string; bot: BotDefinition; config: TestConfig }) {
  const [symbol, setSymbol] = useState(initialSymbol)
  const [interval, setInterval] = useState(['1m', '5m', '15m', '30m', '1h'].includes(initialInterval) ? initialInterval : '15m')
  const [leverage, setLeverage] = useState(3)
  const [connected, setConnected] = useState(false); const [price, setPrice] = useState(0); const [cash, setCash] = useState(10_000); const [units, setUnits] = useState(0); const [auto, setAuto] = useState(false); const [events, setEvents] = useState<string[]>([]); const socket = useRef<WebSocket | null>(null)
  const cashRef = useRef(10_000); const unitsRef = useRef(0); const entryPriceRef = useRef(0); const historyRef = useRef<Candle[]>([]); const autoRef = useRef(false)
  const equity = marketMode === 'futures' ? cash + (entryPriceRef.current && units ? (price - entryPriceRef.current) * units : 0) : cash + units * price
  const paperOrder = (side: 'buy' | 'sell', fillPrice: number, source = 'MANUAL') => {
    if (!fillPrice) return
    if (marketMode === 'futures') {
      if (unitsRef.current === 0) {
        const margin = cashRef.current * .25; const quantity = margin * leverage / fillPrice * (side === 'buy' ? 1 : -1)
        unitsRef.current = quantity; entryPriceRef.current = fillPrice; setUnits(quantity); setEvents((items) => [`${source} · OPENED ${side === 'buy' ? 'LONG' : 'SHORT'} ${leverage}x @ ${formatMoney(fillPrice)}`, ...items].slice(0, 30)); return
      }
      const closesPosition = (unitsRef.current > 0 && side === 'sell') || (unitsRef.current < 0 && side === 'buy')
      if (closesPosition) {
        const pnl = (fillPrice - entryPriceRef.current) * unitsRef.current; cashRef.current += pnl; unitsRef.current = 0; entryPriceRef.current = 0
        setCash(cashRef.current); setUnits(0); setEvents((items) => [`${source} · CLOSED FUTURES POSITION · ${pnl >= 0 ? '+' : ''}${formatMoney(pnl)}`, ...items].slice(0, 30))
      }
      return
    }
    if (side === 'buy' && cashRef.current > 1 && unitsRef.current === 0) { const spend = cashRef.current * .25; cashRef.current -= spend; unitsRef.current = spend / fillPrice; entryPriceRef.current = fillPrice; setCash(cashRef.current); setUnits(unitsRef.current); setEvents((items) => [`${source} · OPENED POSITION ${formatMoney(spend)} @ ${formatMoney(fillPrice)}`, ...items].slice(0, 30)) }
    if (side === 'sell' && unitsRef.current > 0) { const quantity = unitsRef.current; unitsRef.current = 0; entryPriceRef.current = 0; cashRef.current += quantity * fillPrice; setCash(cashRef.current); setUnits(0); setEvents((items) => [`${source} · CLOSED POSITION ${quantity.toFixed(6)} @ ${formatMoney(fillPrice)}`, ...items].slice(0, 30)) }
  }
  const connect = async () => {
    if (socket.current) { socket.current.close(); socket.current = null; setConnected(false); setEvents((items) => ['Feed paused', ...items]); return }
    try { historyRef.current = await fetchBinanceCandles(symbol, interval, 200, marketMode) } catch { historyRef.current = [] }
    const streamHost = marketMode === 'futures' ? 'wss://fstream.binance.com/ws' : 'wss://stream.binance.com:9443/ws'
    const next = new WebSocket(`${streamHost}/${symbol.toLowerCase()}@kline_${interval}`); socket.current = next
    next.onopen = () => { setConnected(true); setEvents((items) => [`Connected to ${symbol} live ${interval} candles`, ...items]) }
    next.onmessage = (event) => {
      const kline = JSON.parse(event.data).k; const livePrice = Number(kline.c); setPrice(livePrice)
      if (kline.x) {
        const candle: Candle = { time: Number(kline.t), open: Number(kline.o), high: Number(kline.h), low: Number(kline.l), close: livePrice, volume: Number(kline.v) }
        historyRef.current = [...historyRef.current.filter((item) => item.time !== candle.time), candle].slice(-500)
        const signal = runBuiltInBot(bot.id, historyRef.current, bot.params).at(-1)?.signal ?? 'hold'
        const positionReturn = entryPriceRef.current ? unitsRef.current < 0 ? entryPriceRef.current / livePrice - 1 : livePrice / entryPriceRef.current - 1 : 0
        const riskExit = unitsRef.current !== 0 && (positionReturn <= -config.stopLossPct / 100 || positionReturn >= config.takeProfitPct / 100)
        setEvents((items) => [`CANDLE CLOSED · ${formatMoney(livePrice)} · ${bot.name}: ${signal.toUpperCase()}`, ...items].slice(0, 30))
        if (riskExit) paperOrder(unitsRef.current < 0 ? 'buy' : 'sell', livePrice, positionReturn < 0 ? 'STOP LOSS' : 'PROFIT TARGET')
        else if (autoRef.current && signal !== 'hold') paperOrder(signal, livePrice, 'BOT')
      }
    }
    next.onerror = () => setEvents((items) => ['Live feed error — Binance may be unavailable in your region', ...items])
    next.onclose = () => { setConnected(false); socket.current = null }
  }
  const closePaperPosition = () => { if (marketMode === 'futures') paperOrder(unitsRef.current < 0 ? 'buy' : 'sell', price, 'MANUAL'); else paperOrder('sell', price) }
  return <><header className="compact-page-header"><h1>Live paper</h1><button className={`run-button ${connected ? 'danger' : ''}`} onClick={connect}>{connected ? <><Pause size={17} /> Stop</> : <><Radio size={17} /> Start feed</>}</button></header>
    <section className={`paper-controls card ${marketMode === 'futures' ? 'with-leverage' : ''}`}><label><HelpLabel help={`Choose a Binance ${marketMode} USDT market.`}>MARKET</HelpLabel><MarketSelect value={symbol} onChange={setSymbol} mode={marketMode} disabled={connected} /></label><label><HelpLabel help="Use 5m or 15m for most intraday tests.">CANDLE SIZE</HelpLabel><select value={interval} disabled={connected} onChange={(event) => setInterval(event.target.value)}><option>1m</option><option>5m</option><option>15m</option><option>30m</option><option>1h</option></select></label>{marketMode === 'futures' && <label><HelpLabel help="Leverage multiplies both profit and loss.">LEVERAGE</HelpLabel><select value={leverage} disabled={connected || units !== 0} onChange={(event) => setLeverage(Number(event.target.value))}>{[1, 2, 3, 5, 10].map((value) => <option value={value} key={value}>{value}x</option>)}</select></label>}<div><b>RISK</b><span>{config.stopLossPct}% stop · {config.takeProfitPct}% target</span></div></section>
    <div className="paper-grid">
      <section className="paper-hero card"><div className="live-row"><span className={connected ? 'live-dot on' : 'live-dot'} /> {connected ? 'LIVE' : 'OFFLINE'}<span>{marketMode.toUpperCase()} · {symbol} · {interval}</span></div><div className="paper-price">{price ? formatMoney(price) : '—'}</div><div className="paper-actions"><button onClick={() => paperOrder('buy', price)}>{marketMode === 'futures' ? 'Long' : 'Buy 25%'}</button>{marketMode === 'futures' && <button className="sell" onClick={() => paperOrder('sell', price)}>Short</button>}<button className="close-position" onClick={closePaperPosition} disabled={!units}>Close</button><button className={auto ? 'auto-on' : 'auto-off'} onClick={() => { const next = !auto; setAuto(next); autoRef.current = next; setEvents((items) => [`Bot autopilot ${next ? 'enabled' : 'disabled'}`, ...items]) }}>{auto ? 'Auto on' : 'Auto off'}</button></div></section>
      <section className="paper-account card"><span className="eyebrow">PAPER ACCOUNT</span><Metric label="Session P/L" value={formatMoney(equity - 10_000)} tone={equity >= 10_000 ? 'good' : 'bad'} /><Metric label="Equity" value={formatMoney(equity)} /><Metric label="Cash" value={formatMoney(cash)} /><Metric label="Position" value={marketMode === 'futures' ? units > 0 ? `LONG ${leverage}x` : units < 0 ? `SHORT ${leverage}x` : 'NONE' : `${units.toFixed(6)} ${symbol.replace('USDT', '')}`} /><div className="bot-chip"><Bot size={17} /><div><b>{bot.name}</b><span>Active bot</span></div></div></section>
      <section className="paper-log card"><div className="card-title"><div><h2>Live event log</h2><span>Connection and paper orders</span></div></div>{events.length ? events.map((event, index) => <div className="log-event" key={index}><CircleDot size={13} /><span>{event}</span><time>{new Date().toLocaleTimeString()}</time></div>) : <div className="empty">Start the feed to begin a paper session.</div>}</section>
    </div></>
}

function BotLibrary({ selectedBotId, pythonBotName, pythonCode, onImport, onChoose, onPython }: { selectedBotId: string; pythonBotName: string; pythonCode: string; onImport: () => void; onChoose: (bot: BotDefinition) => void; onPython: () => void }) {
  const supportsBacktest = pythonCode.includes('generate_signals')
  const supportsForecast = pythonCode.includes('forecast_prices')
  return <>
    <header className="compact-page-header"><h1>Day-trading bots</h1><button className="run-button" onClick={onImport}><Upload size={17} /> Import .py</button></header>
    <section className="import-guide card"><div><ShieldCheck size={20} /><span><b>Local browser runner</b><small>Imported code runs in a timed browser worker. Never place exchange keys or secrets inside a bot file.</small></span></div><a href="/../examples/python_momentum_bot.py" onClick={(event) => event.preventDefault()}>Use the included adapter template from the examples folder</a></section>
    <div className="library-grid">
      {builtInBots.map((bot, index) => <article className="bot-card card" key={bot.id}><div className={`bot-icon tone-${index}`}><Bot size={23} /></div><div className="bot-card-top"><span>{bot.category}</span>{selectedBotId === bot.id && <em>ACTIVE</em>}</div><h2>{bot.name}</h2><p>{bot.description}</p><div className="bot-contract"><span>5M–15M</span><span>SESSION TEST</span><span>LIVE PAPER</span></div><button onClick={() => onChoose(bot)}>Use for day trading <span>→</span></button></article>)}
      <article className="bot-card card python-card"><div className="bot-icon"><Braces size={23} /></div><div className="bot-card-top"><span>Imported Python</span>{selectedBotId === 'python' && <em>ACTIVE</em>}</div><h2>{pythonBotName}</h2><p>Open-source Python adapter loaded into the local browser runner.</p><div className="bot-contract"><span className={supportsBacktest ? 'supported' : 'missing'}>{supportsBacktest ? '✓ BACKTEST' : '✕ NO BACKTEST'}</span><span className={supportsForecast ? 'supported' : 'missing'}>{supportsForecast ? '✓ FORECAST' : '✕ NO FORECAST'}</span><span>30S LIMIT</span></div><div className="bot-card-actions"><button onClick={onImport}><Upload size={13} /> Replace file</button><button onClick={onPython} disabled={!supportsBacktest}>Open & test <span>→</span></button></div></article>
    </div>
    <section className="contract-card card"><div><span className="eyebrow">OPEN-SOURCE ADAPTER</span><h2>Two optional functions</h2><p>Add <code>generate_signals</code> for backtesting, <code>forecast_prices</code> for Forecast Lab, or both. Models that require PyTorch, TensorFlow, local weights or arbitrary packages need a separate backend adapter.</p></div><pre>{`def generate_signals(candles, params):\n    return signals\n\ndef forecast_prices(candles, future_times, params):\n    return predicted_prices`}</pre></section>
  </>
}

export default App
