import { useEffect, useRef } from 'react'
import { CandlestickSeries, ColorType, createChart, LineSeries, createSeriesMarkers } from 'lightweight-charts'
import type { BacktestResult, Candle } from '../types'

type Props = { candles: Candle[]; result: BacktestResult | null }

export function PriceChart({ candles, result }: Props) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current || !candles.length) return
    const chart = createChart(host.current, {
      height: 410,
      layout: { background: { type: ColorType.Solid, color: '#101315' }, textColor: '#899196', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: '#1d2225' }, horzLines: { color: '#1d2225' } },
      rightPriceScale: { borderColor: '#2a3034' }, timeScale: { borderColor: '#2a3034', timeVisible: true },
      crosshair: { vertLine: { color: '#697277', labelBackgroundColor: '#2a3034' }, horzLine: { color: '#697277', labelBackgroundColor: '#2a3034' } },
    })
    const toTime = (milliseconds: number) => Math.floor(milliseconds / 1000) as never
    const candlesSeries = chart.addSeries(CandlestickSeries, { upColor: '#b7f34a', downColor: '#ff665c', wickUpColor: '#b7f34a', wickDownColor: '#ff665c', borderVisible: false })
    candlesSeries.setData(candles.map((item) => ({ time: toTime(item.time), open: item.open, high: item.high, low: item.low, close: item.close })))
    if (result) {
      const predicted = chart.addSeries(LineSeries, { color: '#b980ff', lineWidth: 2, title: 'Prediction', priceLineVisible: false, lastValueVisible: false })
      predicted.setData(result.outputs.filter((item) => Number.isFinite(item.predictedPrice)).map((item) => ({ time: toTime(item.time), value: item.predictedPrice })))
      createSeriesMarkers(candlesSeries, result.trades.map((trade) => ({
        time: toTime(trade.time), position: trade.side === 'buy' ? 'belowBar' : 'aboveBar', color: trade.side === 'buy' ? '#b7f34a' : '#ff665c', shape: trade.side === 'buy' ? 'arrowUp' : 'arrowDown', text: trade.side.toUpperCase(),
      })))
    }
    chart.timeScale().fitContent()
    const observer = new ResizeObserver(([entry]) => chart.applyOptions({ width: entry.contentRect.width }))
    observer.observe(host.current)
    return () => { observer.disconnect(); chart.remove() }
  }, [candles, result])
  return <div ref={host} className="chart-host" />
}
