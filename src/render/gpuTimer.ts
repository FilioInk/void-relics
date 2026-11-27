/**
 * GPU frame time from EXT_disjoint_timer_query_webgl2, for the ?perf=1 overlay. Results arrive a
 * few frames late, so finished queries are polled each frame and handed back as milliseconds.
 * Browsers that hide the extension (Safari, some privacy modes) get `supported: false`.
 */

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

export type GpuTimer = {
  readonly supported: boolean;
  begin(): void;
  end(): void;
  /** Milliseconds of every query that finished since the last poll, oldest first. */
  poll(out: number[]): number[];
};

export function createGpuTimer(gl: WebGL2RenderingContext): GpuTimer {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  const free: WebGLQuery[] = [];
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;

  if (!ext) return { supported: false, begin() {}, end() {}, poll: (out) => ((out.length = 0), out) };

  return {
    supported: true,
    begin() {
      // Too many in flight means the driver is not answering; skip rather than pile up.
      if (active || pending.length > 8) return;
      active = free.pop() ?? gl.createQuery();
      if (active) gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll(out) {
      out.length = 0;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      while (pending.length > 0) {
        const q = pending[0]!;
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        pending.shift();
        free.push(q);
        // A disjoint event (power state change, context switch) makes the reading meaningless.
        if (!disjoint) out.push(ns / 1e6);
      }
      return out;
    },
  };
}
