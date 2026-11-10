import ora from 'ora';

const FALLBACK_COLUMNS = 80;
const FALLBACK_ROWS = 24;

/**
 * Ora uses `stream.columns ?? 80`; a literal `0` bypasses that fallback and
 * yields Infinity line clears (runaway ANSI). Floor first so values in (0,1)
 * cannot become 0 after Math.floor and re-enter the unsafe path.
 * @param {unknown} columns
 * @param {number} [fallback]
 * @returns {number}
 */
export function resolveSpinnerColumns(columns, fallback = FALLBACK_COLUMNS) {
  if (typeof columns !== 'number' || !Number.isFinite(columns)) return fallback;
  const width = Math.floor(columns);
  return width > 0 ? width : fallback;
}

/**
 * @param {unknown} rows
 * @param {number} [fallback]
 * @returns {number}
 */
export function resolveSpinnerRows(rows, fallback = FALLBACK_ROWS) {
  if (typeof rows !== 'number' || !Number.isFinite(rows)) return fallback;
  const value = Math.floor(rows);
  return value > 0 ? value : fallback;
}

/**
 * Always wrap: TTY geometry can change after spinner creation (e.g. 80→0).
 * @param {NodeJS.WritableStream & { columns?: number, rows?: number, isTTY?: boolean }} stream
 */
export function withSafeGeometry(stream) {
  return new Proxy(stream, {
    get(target, prop, receiver) {
      if (prop === 'columns') return resolveSpinnerColumns(target.columns);
      if (prop === 'rows') return resolveSpinnerRows(target.rows);
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Create an ora spinner that never treats TTY width 0/NaN/Infinity as valid.
 * Positive finite TTY geometry stays positive; live resizes are re-checked.
 * @param {string} [text]
 * @param {import('ora').Options} [options]
 */
export function createSpinner(text = '', options = {}) {
  const stream = options.stream ?? process.stderr;
  const safeStream = withSafeGeometry(stream);
  return ora({
    ...options,
    text,
    stream: safeStream,
  });
}
