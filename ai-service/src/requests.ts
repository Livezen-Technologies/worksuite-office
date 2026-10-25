// X-Request-Id: any request may name itself; DELETE /v1/requests/{id} aborts it (suggestions on every keystroke).
export class RequestRegistry {
  private live = new Map<string, AbortController>();
  register(id: string | undefined, ac: AbortController): () => void {
    if (!id) return () => undefined;
    this.live.get(id)?.abort(); // a reused id replaces the older request
    this.live.set(id, ac);
    return () => { if (this.live.get(id) === ac) this.live.delete(id); };
  }
  cancel(id: string): boolean {
    const ac = this.live.get(id);
    if (!ac) return false;
    ac.abort();
    this.live.delete(id);
    return true;
  }
  get size(): number { return this.live.size; }
}
