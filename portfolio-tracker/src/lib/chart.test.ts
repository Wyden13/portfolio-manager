import { describe, expect, it } from 'vitest'
import { nearestIndex, niceStep, plotSeries, tickIndices } from './chart'
import { squarify } from './treemap'

describe('chart scale', () => {
  it('picks round gridline steps', () => {
    expect(niceStep(40_000)).toBe(10_000)
    expect(niceStep(9)).toBe(2.5)
    expect(niceStep(0.7)).toBe(0.2)
  })

  it('puts gridlines just outside the data', () => {
    const plot = plotSeries([217_000, 230_000, 248_312])
    expect(plot.grid[0].label).toBe('210,000')
    expect(plot.grid.at(-1)!.label).toBe('250,000')
    expect(plot.grid.at(-1)!.y).toBe(0)
    expect(plot.grid[0].y).toBe(220)
    expect(plot.line.startsWith('M0.0 ')).toBe(true)
    expect(plot.line).toContain('L800.0 ')
    expect(plot.yOf(300_000)).toBeNull()
  })

  it('handles a flat or single-point series', () => {
    expect(plotSeries([5]).line).toMatch(/^M0\.0 [\d.]+ L800\.0 [\d.]+$/)
    expect(plotSeries([5, 5]).grid.length).toBeGreaterThan(1)
  })

  it('spreads ticks and finds the nearest point', () => {
    expect(tickIndices(100, 5)).toEqual([0, 25, 50, 74, 99])
    expect(tickIndices(3, 5)).toEqual([0, 1, 2])
    expect(nearestIndex(0.5, 11)).toBe(5)
    expect(nearestIndex(2, 11)).toBe(10)
  })
})

describe('squarify', () => {
  it('fills the box with areas proportional to weight', () => {
    const placed = squarify([6, 6, 4, 3, 2, 2, 1], (n) => n, { x: 0, y: 0, w: 6, h: 4 })
    expect(placed).toHaveLength(7)
    const area = placed.reduce((a, p) => a + p.w * p.h, 0)
    expect(area).toBeCloseTo(24)
    for (const p of placed) expect(p.w * p.h).toBeCloseTo(p.item)
    for (const p of placed) {
      expect(p.x + p.w).toBeLessThanOrEqual(6 + 1e-9)
      expect(p.y + p.h).toBeLessThanOrEqual(4 + 1e-9)
    }
  })

  it('skips empty weights', () => {
    expect(squarify([0, -1], (n) => n, { x: 0, y: 0, w: 1, h: 1 })).toEqual([])
  })
})
