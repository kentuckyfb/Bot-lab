import { useEffect, useRef } from 'react'
import { AreaSeries, ColorType, createChart, LineSeries } from 'lightweight-charts'
import type { BacktestResult } from '../types'

export function EquityChart({ result }: { result: BacktestResult }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const chart = createChart(host.current, { height: 210, layout: { background: { type: ColorType.Solid, color: '#101315' }, textColor: '#899196' }, grid: { vertLines: { color: '#1d2225' }, horzLines: { color: '#1d2225' } }, rightPriceScale: { borderVisible: false }, timeScale: { borderColor: '#2a3034' } })
    const strategy = chart.addSeries(AreaSeries, { lineColor: '#b7f34a', topColor: 'rgba(183,243,74,.24)', bottomColor: 'rgba(183,243,74,0)', lineWidth: 2, title: 'Strategy' })
    const benchmark = chart.addSeries(LineSeries, { color: '#626d73', lineWidth: 2, lineStyle: 2, title: 'Buy & hold' })
    strategy.setData(result.equity.map((item) => ({ time: Math.floor(item.time / 1000) as never, value: item.value })))
    benchmark.setData(result.equity.map((item) => ({ time: Math.floor(item.time / 1000) as never, value: item.benchmark })))
    chart.timeScale().fitContent()
    const observer = new ResizeObserver(([entry]) => chart.applyOptions({ width: entry.contentRect.width })); observer.observe(host.current)
    return () => { observer.disconnect(); chart.remove() }
  }, [result])
  return <div ref={host} />
}
