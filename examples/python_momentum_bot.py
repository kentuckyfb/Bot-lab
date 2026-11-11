"""Example SignalForge bot.

Load this file from Backtest lab > Custom Python > Load .py bot file.
It uses only past and current candles, never future data.
"""


def generate_signals(candles, params):
    fast = int(params.get("fast", 10))
    slow = int(params.get("slow", 30))
    results = []

    for index, candle in enumerate(candles):
        available = candles[: index + 1]
        fast_prices = [row["close"] for row in available[-fast:]]
        slow_prices = [row["close"] for row in available[-slow:]]
        fast_average = sum(fast_prices) / len(fast_prices)
        slow_average = sum(slow_prices) / len(slow_prices)
        edge = (fast_average - slow_average) / slow_average

        if len(available) < slow:
            signal = "hold"
        elif edge > 0.002:
            signal = "buy"
        elif edge < -0.002:
            signal = "sell"
        else:
            signal = "hold"

        results.append(
            {
                "time": candle["time"],
                "predictedPrice": candle["close"] * (1 + edge * 0.25),
                "direction": "up" if edge > 0 else "down" if edge < 0 else "flat",
                "confidence": min(0.90, 0.50 + abs(edge) * 15),
                "expectedReturn": edge * 0.25,
                "signal": signal,
            }
        )

    return results


def forecast_prices(candles, future_times, params):
    """Optional Forecast Lab adapter.

    Replace this calculation with an open-source model's predict method.
    Return exactly one positive price for every future timestamp.
    """
    lookback = int(params.get("window", 48))
    closes = [row["close"] for row in candles]
    returns = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]
    momentum = sum(returns[-lookback:]) / max(1, len(returns[-lookback:]))
    momentum = max(-0.003, min(0.003, momentum))
    last_price = closes[-1]
    return [last_price * ((1 + momentum) ** (index + 1)) for index, _ in enumerate(future_times)]
