/** Small server-local display/public-lookup cache. Never use for authorization or workflow writes. */
export class ExpiringCache<T> {
  private entries = new Map<string, { value: T; expires: number; bytes: number }>();
  private bytes = 0;
  private generation = 0;
  constructor(
    private capacity = 32,
    private maxBytes = 512 * 1024,
  ) {}
  clear() {
    this.entries.clear();
    this.bytes = 0;
    this.generation++;
  }
  guard() {
    const generation = this.generation;
    return () => generation === this.generation;
  }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }
  put(key: string, value: T, ttlMs: number) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > this.maxBytes) return;
    const prior = this.entries.get(key);
    if (prior) {
      this.bytes -= prior.bytes;
      this.entries.delete(key);
    }
    while (this.entries.size >= this.capacity || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value: structuredClone(value), expires: Date.now() + ttlMs, bytes });
    this.bytes += bytes;
  }
}
