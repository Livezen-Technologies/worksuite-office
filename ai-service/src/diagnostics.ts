// The last 50 error codes and request timings. Never text or audio: only route, code, duration.
export interface ErrorRecord { at: string; route: string; code: string; status: number }
export interface TimingRecord { at: string; route: string; ms: number; status: number }

export class Diagnostics {
  errors: ErrorRecord[] = [];
  timings: TimingRecord[] = [];
  record(route: string, status: number, ms: number, code?: string): void {
    const at = new Date().toISOString();
    this.timings.push({ at, route, ms: Math.round(ms * 10) / 10, status });
    if (this.timings.length > 50) this.timings.shift();
    if (code) {
      this.errors.push({ at, route, code, status });
      if (this.errors.length > 50) this.errors.shift();
    }
  }
}

/** "/v1/models/whisper-small-q5/install" -> "/v1/models/:id/install": diagnostics never keep ids or words. */
export function routeTemplate(pattern: string | undefined, pathname: string): string {
  return pattern || pathname.replace(/\/[^/]*\d[^/]*/g, "/:id");
}
