# SignalForge Bot Lab

Local-first crypto day-trading research dashboard. It tests short-interval bot predictions, simulates intraday entries and exits with fees and slippage, loads public Binance candles, and provides a live paper-trading feed.

The interface has three top-level areas:

- **Forecast & Test:** separate Binance Spot and USDⓈ-M Futures modes. Futures supports simulated long, short, and 1x–10x leverage.
- **Live Paper:** current public prices and virtual orders.
- **Bots:** built-in strategies and open-source Python adapter imports.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:4173`.

## Included

- Four configurable intraday strategies: EMA momentum, RSI pullback, volume breakout, and VWAP reversion
- Custom Python strategies through Pyodide in a Web Worker
- Demo, Binance REST, and CSV/TSV data sources
- Binance Spot and USDⓈ-M Futures market lists, historical candles, and live paper feeds
- Candlestick, prediction, signal, equity, and benchmark visuals
- Cost-aware next-candle-open backtesting
- Live Binance public candle stream, manual paper orders, and opt-in bot autopilot

## CSV format

The importer accepts common case-insensitive column names. Required: `time`, `open`, `high`, `low`, and `close`. Optional: `volume`. Time may be an ISO date or Unix timestamp in seconds or milliseconds.

## Python bot contract

Define `generate_signals(candles, params)` and return one dictionary per candle with `time`, `predictedPrice`, `direction`, `confidence`, `expectedReturn`, and `signal`.

### Load a different bot

1. Open **Bots**.
2. Click **Load open-source .py bot** and select `examples/python_momentum_bot.py`.
3. Confirm the bot supports `forecast_prices`, then choose **Use in Forecast & Test**.
4. Select the training dates and the later hidden prediction dates.
5. Open **Money & risk settings** to set the virtual amount, entry filters, stop loss, and take profit.
6. Generate the forecast, review the recorded plan, then reveal the actual period to see the result.

An external open-source bot needs a small adapter if it does not already expose `generate_signals(candles, params)`. Its output must contain:

```python
{
    "time": candle["time"],
    "predictedPrice": 68420.0,
    "direction": "up",       # up, down, or flat
    "confidence": 0.68,       # 0.0 to 1.0
    "expectedReturn": 0.012,  # decimal: 0.012 means 1.2%
    "signal": "buy",         # buy, sell, or hold
}
```

Bots that depend on TensorFlow, PyTorch, exchange SDKs, local model files, or arbitrary pip packages need a separate Python service; the in-browser runner is intended for self-contained Python logic. Never expose exchange API keys to an imported bot.

For Forecast Lab support, the same file may also define:

```python
def forecast_prices(candles, future_times, params):
    # Return one positive price for every timestamp in future_times.
    return predicted_prices
```

The Bots screen detects these functions and shows the imported adapter's available capabilities. `examples/python_momentum_bot.py` implements both contracts. Imported code runs locally in a timed Pyodide worker, but it should still be reviewed before execution. Generic projects that require native packages, model-weight downloads or filesystem access need a separate backend adapter.

### Reading the result

- **BUY CANDIDATE** means the bot said buy and passed your minimum confidence and expected-return filters.
- **SELL / EXIT** means the bot emitted a sell signal. Stop-loss and take-profit rules can also close simulated positions.
- **WAIT** means the latest output did not pass the entry rules.
- Net return, drawdown, fees, directional accuracy, trades, and the passive benchmark determine whether the behavior is worth further paper testing.

A profitable backtest is a research result, not evidence of future profit. Test untouched dates, increase cost assumptions, and run live paper trading before considering real funds.

## Forecast & Test

This single workflow replaces the old separate forecast, backtest, and replay screens. It separates model input from the period being predicted:

1. Choose a **training range** that the model is allowed to study.
2. Choose a later **prediction range** whose actual prices remain hidden.
3. Select the market, candle interval, forecasting model, and whether the simulated account starts in cash or already holding the coin.
4. Generate the forecast and review its recorded `BUY & HOLD`, `HOLD CASH`, `SELL / EXIT`, or `HOLD COIN` plan.
5. Reveal historical actual prices to compare the purple forecast with the blue actual path.
6. Review overall direction, candle direction accuracy, average price error, executed trades, ending state, and simulated profit or loss.

The current forecasting models are transparent statistical baselines—trend regression, recent momentum, and mean reversion—not guaranteed predictive AI. If the prediction dates are in the future, actual prices cannot be revealed yet; use the forecast only as a paper-trading hypothesis.

Python code runs in a browser worker with a 20-second limit. The first run downloads Pyodide from jsDelivr. This is suitable for reviewing trusted open-source strategy code, not hostile-code multi-user execution.

## Deployment note

The current app is a static Vite application and can be deployed to Vercel. Public Binance endpoints may be blocked in some countries or by browser/network policy; add a server-side data proxy or another exchange adapter before production use.

TradingView is not used as a data source. Its charting library expects you to supply your own market-data feed.
