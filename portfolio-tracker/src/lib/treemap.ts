export interface Rect { x: number; y: number; w: number; h: number }
export interface Placed<T> extends Rect { item: T }

const worst = (row: number[], side: number) => {
  const s = row.reduce((a, b) => a + b, 0)
  const max = Math.max(...row)
  const min = Math.min(...row)
  return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
}

/**
 * Squarified treemap (Bruls et al.): lays `items` out in `box` with areas proportional to
 * `weight`, keeping tiles close to square. Items with no weight are left out.
 */
export function squarify<T>(items: T[], weight: (item: T) => number, box: Rect): Placed<T>[] {
  const list = items.map((item) => ({ item, w: weight(item) })).filter((e) => e.w > 0).sort((a, b) => b.w - a.w)
  const total = list.reduce((a, e) => a + e.w, 0)
  if (!total || box.w <= 0 || box.h <= 0) return []
  const scale = (box.w * box.h) / total
  const areas = list.map((e) => e.w * scale)
  const out: Placed<T>[] = []
  let { x, y, w, h } = box
  let i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const row = [areas[i]]
    let j = i + 1
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) {
      row.push(areas[j])
      j++
    }
    const sum = row.reduce((a, b) => a + b, 0)
    if (w >= h) {
      // Lay the row out as a column on the left.
      const cw = sum / h
      let cy = y
      row.forEach((a, k) => { const ch = a / cw; out.push({ item: list[i + k].item, x, y: cy, w: cw, h: ch }); cy += ch })
      x += cw
      w -= cw
    } else {
      const rh = sum / w
      let cx = x
      row.forEach((a, k) => { const rw = a / rh; out.push({ item: list[i + k].item, x: cx, y, w: rw, h: rh }); cx += rw })
      y += rh
      h -= rh
    }
    i = j
  }
  return out
}
