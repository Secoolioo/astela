/** A call that needs the code, and what runs in its place when the code cannot load. */
interface Waiting<T> {
  readonly call: (code: T) => void;
  readonly without: (() => void) | undefined;
}

/**
 * Code that loads with its first use, such as a chunk of the browser process that the start
 * does not need. A call that comes while the code loads waits for it, and the calls that wait
 * run in their order, at once when the code is there, before any later call; a call after
 * that runs at once. When the code cannot load, the calls that wait run what they do without
 * it, if anything, and so does every later call.
 */
export class LaterCode<T> {
  private readonly load: () => Promise<T>;
  private readonly failed: (error: unknown) => void;
  private code: T | undefined;
  private loading: Promise<void> | undefined;
  private broken = false;
  private readonly waiting: Waiting<T>[] = [];

  /**
   * @param load - Loads the code, such as with `import()`; it is called once.
   * @param failed - Receives the error when the code cannot load, and the error of a call
   *   that waited for it, which keeps the calls after it from running otherwise.
   */
  constructor(load: () => Promise<T>, failed: (error: unknown) => void) {
    this.load = load;
    this.failed = failed;
  }

  /** The code once it has loaded. */
  get loaded(): T | undefined {
    return this.code;
  }

  /** Starts to load the code, if it has not, without a call that waits for it. */
  prepare(): void {
    if (this.code === undefined && !this.broken) this.start();
  }

  /**
   * Runs a call with the code: at once when it has loaded, or else once it is there, after
   * the calls that came before.
   * @param call - What to do with the code.
   * @param without - What to do instead when the code cannot load.
   */
  run(call: (code: T) => void, without?: () => void): void {
    if (this.code !== undefined) {
      call(this.code);
      return;
    }
    if (this.broken) {
      without?.();
      return;
    }
    this.waiting.push({ call, without });
    this.start();
  }

  /**
   * Runs a call that does not need the code in its turn: at once, unless calls wait for the
   * code, and then after them, also when the code cannot load.
   * @param call - What to do.
   */
  runInTurn(call: () => void): void {
    if (this.waiting.length === 0) call();
    else this.run(call, call);
  }

  /** Loads the code once; the calls that wait run when it is there, or without it. */
  private start(): void {
    this.loading ??= this.load().then(
      (code) => {
        // A call that a waiting call makes waits behind the others, until all of them ran.
        this.drain((next) => next.call(code));
        this.code = code;
      },
      (error: unknown) => {
        this.broken = true;
        this.failed(error);
        this.drain((next) => next.without?.());
      },
    );
  }

  /** Runs the waiting calls in their order, also those that come meanwhile. */
  private drain(run: (next: Waiting<T>) => void): void {
    for (let next = this.waiting.shift(); next !== undefined; next = this.waiting.shift()) {
      try {
        run(next);
      } catch (error) {
        this.failed(error);
      }
    }
  }
}
