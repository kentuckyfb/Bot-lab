/* global importScripts, loadPyodide */
let runtime

async function getRuntime() {
  if (!runtime) {
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js')
    runtime = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/' })
  }
  return runtime
}

self.onmessage = async (event) => {
  const { code, candles, params, mode = 'signals', futureTimes = [] } = event.data
  try {
    const pyodide = await getRuntime()
    pyodide.globals.set('candles_json', JSON.stringify(candles))
    pyodide.globals.set('params_json', JSON.stringify(params))
    pyodide.globals.set('future_times_json', JSON.stringify(futureTimes))
    pyodide.globals.set('runner_mode', mode)
    await pyodide.runPythonAsync(`
import json
candles = json.loads(candles_json)
params = json.loads(params_json)
future_times = json.loads(future_times_json)
${code}
if runner_mode == "forecast":
    _signalforge_result = json.dumps(forecast_prices(candles, future_times, params))
else:
    _signalforge_result = json.dumps(generate_signals(candles, params))
`)
    self.postMessage({ ok: true, result: JSON.parse(pyodide.globals.get('_signalforge_result')) })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
