/**
 * Stdin reader for hook handlers.
 *
 * Claude Code hook protocol pipes a JSON object to the handler's stdin.
 * This module reads and parses it with a bounded timeout (2s default) so
 * a hook never hangs the session if stdin is empty or malformed.
 *
 * @module lib/stdin
 */

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Read all of stdin into a string, with a timeout.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=2000]
 * @returns {Promise<string>}
 */
export function readStdin(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    const chunks = [];
    let done = false;

    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => finish(null, Buffer.concat(chunks).toString('utf8')), timeoutMs);

    process.stdin.on('data', (chunk) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      else chunks.push(Buffer.from(String(chunk)));
    });
    process.stdin.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', (err) => finish(err));
    process.stdin.resume();
  });
}

/**
 * Read stdin + parse as JSON. Returns an empty object on any failure — hook
 * handlers should fail open on bad input rather than crashing the session.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<object>}
 */
export async function readStdinJson(opts) {
  try {
    const raw = await readStdin(opts);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
