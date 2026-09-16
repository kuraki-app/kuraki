/** A request seam for replaceable reads: abort network work and discard late
 * completions, including loaders that cannot honour AbortSignal. Writes must
 * never use it because cancelling a response cannot undo a server mutation. */
export function latestRequest() {
  let active: AbortController | undefined;
  return {
    cancel() { active?.abort(); active = undefined; },
    async run<T>(read: (signal: AbortSignal) => Promise<T>): Promise<
      { status: 'completed'; value: T } | { status: 'superseded' }
    > {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      try {
        const value = await read(controller.signal);
        return controller.signal.aborted ? { status: 'superseded' } : { status: 'completed', value };
      } catch (error) {
        if (controller.signal.aborted) return { status: 'superseded' };
        throw error;
      } finally {
        if (active === controller) active = undefined;
      }
    }
  };
}
