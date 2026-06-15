import ora, { type Ora, type Options as OraOptions } from 'ora';
import { shouldUseColor } from './colors.js';
import { coloredSymbol } from './symbols.js';

/**
 * Persist a spinner's final line with a color-gated status symbol.
 *
 * ora's own `.succeed()` / `.fail()` color their log-symbols through ora's
 * internal TTY detection, which still emits ANSI on the persisted line when
 * stdout is piped (non-TTY) even though our `shouldUseColor()` says no color.
 * Routing the symbol through `coloredSymbol` (gated by `shouldUseColor`) keeps
 * piped output escape-free while preserving the colored glyph in a real TTY.
 */
const persist = (
  spin: Ora,
  type: 'success' | 'error',
  text?: string
): void => {
  spin.stopAndPersist(
    text === undefined
      ? { symbol: coloredSymbol(type) }
      : { symbol: coloredSymbol(type), text }
  );
};

/**
 * Spinner color options
 */
export type SpinnerColor = 'yellow' | 'green' | 'cyan' | 'red' | 'blue' | 'magenta' | 'white' | 'gray';

/**
 * Spinner configuration options
 */
export interface SpinnerOptions {
  /** Text to display next to the spinner */
  text: string;
  /** Spinner color (default: 'yellow' for Movehat brand) */
  color?: SpinnerColor;
  /** Spinner animation type (default: 'dots') */
  spinner?: OraOptions['spinner'];
  /** Number of spaces to indent (default: 0) */
  indent?: number;
}

/**
 * Create and start a spinner
 * Automatically disabled in non-TTY environments (CI, pipes)
 *
 * @param options - Spinner configuration
 * @returns Ora spinner instance
 *
 * @example
 * const spin = spinner({ text: 'Compiling contracts...' });
 * await longRunningTask();
 * spin.succeed('Compilation complete!');
 *
 * @example
 * const spin = spinner({ text: 'Fetching data...', color: 'cyan' });
 * try {
 *   await fetchData();
 *   spin.succeed('Data fetched!');
 * } catch (error) {
 *   spin.fail('Failed to fetch data');
 * }
 */
export const spinner = (options: SpinnerOptions): Ora => {
  const { text, color = 'yellow', spinner = 'dots', indent = 0 } = options;

  const prefixSpaces = ' '.repeat(indent);

  const oraOptions: OraOptions = {
    text: prefixSpaces + text,
    color,
    spinner,
    // Disable spinner if not TTY (CI environments, piped output)
    isEnabled: shouldUseColor() && Boolean(process.stdout.isTTY),
  };

  return ora(oraOptions).start();
};

/**
 * Execute async task with spinner
 * Handles success/error automatically and always cleans up
 *
 * @param startText - Initial spinner text
 * @param task - Async function to execute
 * @param successText - Text to show on success (optional, defaults to startText without '...')
 * @param errorText - Text to show on error (optional, defaults to error message)
 * @param indent - Number of spaces to indent (default: 0)
 * @returns Promise resolving to task result
 *
 * @example
 * const data = await withSpinner(
 *   'Fetching network data...',
 *   async () => await fetchData(),
 *   'Data fetched successfully'
 * );
 *
 * @example
 * await withSpinner(
 *   'Creating fork...',
 *   async () => await createFork(),
 *   'Fork created!',
 *   'Failed to create fork'
 * );
 */
export const withSpinner = async <T>(
  startText: string,
  task: () => Promise<T>,
  successText?: string,
  errorText?: string,
  indent: number = 0
): Promise<T> => {
  const spin = spinner({ text: startText, indent });

  try {
    const result = await task();
    persist(spin, 'success', successText || startText.replace(/\.\.\.?$/, ''));
    return result;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    persist(spin, 'error', errorText || `Failed: ${errMsg}`);
    throw error;
  }
};

/**
 * Execute async task with a spinner that updates its label with
 * elapsed seconds while the task runs. Use for long-running phases
 * (local node startup, publish + tx wait) where the user wants
 * visible progress feedback in lieu of subprocess chatter.
 *
 * Pairs with the `§9` console-UX convention: any phase that
 * empirically takes ≥3s in normal use should wrap its body in
 * `withTimedSpinner` so the terminal never goes silent while work
 * happens.
 *
 * @param label - Stable label shown next to the spinner (e.g. "Starting node")
 * @param task - Async function to execute
 * @param indent - Number of spaces to indent (default: 0)
 * @returns Promise resolving to task result
 *
 * @example
 * await withTimedSpinner('Starting local node', async () => {
 *   await this.waitForReady(60_000);
 * });
 * // Renders: ⠋ Starting local node — 0.0s ... ⠼ Starting local node — 14.2s
 * // On success: ✔ Starting local node (14.2s)
 * // On error:   ✖ <error.message>
 */
export const withTimedSpinner = async <T>(
  label: string,
  task: () => Promise<T>,
  indent: number = 0
): Promise<T> => {
  const start = Date.now();
  const spin = spinner({ text: `${label} — 0.0s`, indent });
  const timer = setInterval(() => {
    spin.text = `${label} — ${((Date.now() - start) / 1000).toFixed(1)}s`;
  }, 500);
  try {
    const result = await task();
    persist(spin, 'success', `${label} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    return result;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    persist(spin, 'error', errMsg);
    throw error;
  } finally {
    clearInterval(timer);
  }
};

/**
 * Spinner chain for sequential operations
 * Manages multiple spinners in sequence
 */
export interface SpinnerChain {
  /**
   * Add and execute a step in the chain
   */
  add<T>(text: string, task: () => Promise<T>, indent?: number): Promise<T>;

  /**
   * Complete the chain (cleanup)
   */
  complete(): void;
}

/**
 * Create a sequential spinner chain
 * Useful for multi-step processes like initialization
 *
 * @returns SpinnerChain interface
 *
 * @example
 * const steps = createSpinnerChain();
 *
 * await steps.add('Creating directories...', async () => {
 *   await mkdir(projectPath);
 * });
 *
 * await steps.add('Copying templates...', async () => {
 *   await copyFiles();
 * });
 *
 * await steps.add('Installing dependencies...', async () => {
 *   await npmInstall();
 * });
 *
 * steps.complete();
 */
export const createSpinnerChain = (): SpinnerChain => {
  let currentSpinner: Ora | null = null;

  return {
    async add<T>(
      text: string,
      task: () => Promise<T>,
      indent: number = 0
    ): Promise<T> {
      currentSpinner = spinner({ text, indent });
      try {
        const result = await task();
        persist(currentSpinner, 'success');
        return result;
      } catch (error) {
        persist(currentSpinner, 'error');
        throw error;
      }
    },

    complete() {
      if (currentSpinner) {
        currentSpinner.stop();
      }
    },
  };
};
