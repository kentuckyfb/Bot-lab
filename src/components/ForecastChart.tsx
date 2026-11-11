import { useEffect, useRef } from 'react'
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, LineSeries, LineStyle } from 'lightweight-charts'
import type { Candle } from '../types'
import type { ForecastOutput, ForecastScore } from '../lib/forecast'

export function ForecastChart({ training, actual, forecast, score, revealed }: { training: Candle[]; actual: Candle[]; forecast: ForecastOutput; score: ForecastScore | null; revealed: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const chart = createChart(host.current, {
      height: 420,
      layout: { background: { type: ColorType.Solid, color: '#101315' }, textColor: '#899196', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: '#1d2225' }, horzLines: { color: '#1d2225' } },
      rightPriceScale: { borderColor: '#2a3034' }, timeScale: { borderColor: '#2a3034', timeVisible: true },
    })
    const time = (value: number) => Math.floor(value / 1000) as never
    const candles = chart.addSeries(CandlestickSeries, { upColor: '#b7f34a', downColor: '#ff665c', wickUpColor: '#b7f34a', wickDownColor: '#ff665c', borderVisible: false })
    const shownTraining = training.slice(-Math.min(500, training.length))
    const candleData = [...shownTraining, ...(revealed ? actual : [])]
    candles.setData(candleData.map((item) => ({ time: time(item.time), open: item.open, high: item.high, low: item.low, close: item.close })))

    const prediction = chart.addSeries(LineSeries, { color: '#b980ff', lineWidth: 3, title: 'Forecast', priceLineVisible: false })
    prediction.setData([{ time: time(training.at(-1)!.time), value: training.at(-1)!.close }, ...forecast.points.map((point) => ({ time: time(point.time), value: point.predicted }))])
    const upper = chart.addSeries(LineSeries, { color: 'rgba(185,128,255,.35)', lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'Likely range', priceLineVisible: false, lastValueVisible: false })
    const lower = chart.addSeries(LineSeries, { color: 'rgba(185,128,255,.35)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
    upper.setData(forecast.points.map((point) => ({ time: time(point.time), value: point.upper })))
    lower.setData(forecast.points.map((point) => ({ time: time(point.time), value: point.lower })))

    if (revealed) {
      const actualLine = chart.addSeries(LineSeries, { color: '#49c6e5', lineWidth: 2, title: 'Actual', priceLineVisible: false })
      actualLine.setData([{ time: time(training.at(-1)!.time), value: training.at(-1)!.close }, ...actual.map((candle) => ({ time: time(candle.time), value: candle.close }))])
      if (score?.trades.length) createSeriesMarkers(candles, score.trades.map((trade) => ({ time: time(trade.time), position: trade.side === 'buy' ? 'belowBar' : 'aboveBar', color: trade.side === 'buy' ? '#b7f34a' : '#ff665c', shape: trade.side === 'buy' ? 'arrowUp' : 'arrowDown', text: trade.side.toUpperCase() })))
    }
    chart.timeScale().fitContent()
    const observer = new ResizeObserver(([entry]) => chart.applyOptions({ width: entry.contentRect.width })); observer.observe(host.current)
    return () => { observer.disconnect(); chart.remove() }
  }, [training, actual, forecast, score, revealed])
  return <div ref={host} />
}
