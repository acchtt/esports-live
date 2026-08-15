import { writeFile } from 'node:fs/promises';

const endpoint = String(process.env.ARENA_ANDROID_DEVTOOLS_URL ?? 'http://127.0.0.1:9222').replace(/\/$/, '');
const outputPath = String(process.env.ARENA_ANDROID_WEBVIEW_REPORT ?? 'artifacts/android-smoke-webview.json');
const timeoutMs = Number(process.env.ARENA_ANDROID_WEBVIEW_TIMEOUT_MS ?? '30000');
const deadline = Date.now() + timeoutMs;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function targets() {
  const response = await fetch(`${endpoint}/json`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`DevTools returned HTTP ${response.status}.`);
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error('DevTools target list is invalid.');
  return value;
}

async function evaluate(webSocketDebuggerUrl) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('WebView evaluation timed out.'));
    }, 5000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(() => {
            const app = document.querySelector('#app');
            const body = document.body;
            return {
              url: location.href,
              title: document.title,
              readyState: document.readyState,
              appChildren: app ? app.childElementCount : -1,
              text: body ? body.innerText.slice(0, 4000) : '',
              htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
              bodyBackground: body ? getComputedStyle(body).backgroundColor : ''
            };
          })()`,
          returnByValue: true
        }
      }));
    });

    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) {
        reject(new Error(message.error.message ?? 'WebView evaluation failed.'));
        return;
      }
      resolve(message.result?.result?.value ?? null);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Could not connect to the WebView debugger.'));
    });
  });
}

let lastError = null;
while (Date.now() < deadline) {
  try {
    const pages = await targets();
    const target = pages.find(page => page.type === 'page' && /appassets\.androidplatform\.net/i.test(page.url ?? ''))
      ?? pages.find(page => page.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable WebView page is available.');

    const report = await evaluate(target.webSocketDebuggerUrl);
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    const rendered = report
      && report.readyState === 'complete'
      && report.appChildren > 0
      && /ARENA/i.test(report.text ?? '');
    if (!rendered) throw new Error(`ARENA did not render: ${JSON.stringify(report)}`);
    console.log(`Verified rendered ARENA WebView at ${report.url}.`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    await delay(1000);
  }
}

const failure = {
  error: lastError instanceof Error ? lastError.message : String(lastError ?? 'Unknown WebView failure.'),
  endpoint,
  timeoutMs
};
await writeFile(outputPath, `${JSON.stringify(failure, null, 2)}\n`);
throw new Error(failure.error);
