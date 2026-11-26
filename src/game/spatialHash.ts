/** Uniform grid over 3D space for "what is near the ship" queries against thousands of rocks. */
export class SpatialHash<T extends { position: [number, number, number]; radius: number }> {
  private readonly cells = new Map<string, T[]>();
  private readonly cellSize: number;
  /** Reused by query(), which runs several times a frame. */
  private readonly seen = new Set<T>();

  constructor(cellSize: number, items: readonly T[] = []) {
    this.cellSize = cellSize;
    for (const item of items) this.insert(item);
  }

  private key(ix: number, iy: number, iz: number): string {
    return `${ix},${iy},${iz}`;
  }

  insert(item: T): void {
    const s = this.cellSize;
    const [x, y, z] = item.position;
    const r = item.radius;
    for (let ix = Math.floor((x - r) / s); ix <= Math.floor((x + r) / s); ix++)
      for (let iy = Math.floor((y - r) / s); iy <= Math.floor((y + r) / s); iy++)
        for (let iz = Math.floor((z - r) / s); iz <= Math.floor((z + r) / s); iz++) {
          const k = this.key(ix, iy, iz);
          const list = this.cells.get(k);
          if (list) list.push(item);
          else this.cells.set(k, [item]);
        }
  }

  /** Items whose bounding sphere may touch the query sphere (deduplicated). */
  query(x: number, y: number, z: number, radius: number, out: T[] = []): T[] {
    out.length = 0;
    const s = this.cellSize;
    const seen = this.seen;
    seen.clear();
    for (let ix = Math.floor((x - radius) / s); ix <= Math.floor((x + radius) / s); ix++)
      for (let iy = Math.floor((y - radius) / s); iy <= Math.floor((y + radius) / s); iy++)
        for (let iz = Math.floor((z - radius) / s); iz <= Math.floor((z + radius) / s); iz++) {
          const list = this.cells.get(this.key(ix, iy, iz));
          if (!list) continue;
          for (const item of list) {
            if (seen.has(item)) continue;
            seen.add(item);
            const [px, py, pz] = item.position;
            if (Math.hypot(px - x, py - y, pz - z) <= radius + item.radius) out.push(item);
          }
        }
    seen.clear();
    return out;
  }
}
