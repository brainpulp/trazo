import { describe, expect, it } from 'vitest';
import { buildRibbon, buildTube, mirrorX, pressureToScale } from './strokeGeometry';

const line = [0, 0, 0, 1, 0, 0, 2, 0.5, 0, 3, 1, 1];
const radii = [0.1, 0.2, 0.2, 0.1];

describe('buildTube', () => {
  it('builds rings plus cap centers with valid indices', () => {
    const m = buildTube(line, radii, 8)!;
    expect(m.positions.length).toBe((4 * 8 + 2) * 3);
    expect(m.indices.length).toBe(3 * 8 * 6 + 8 * 6);
    const vcount = m.positions.length / 3;
    expect(Math.max(...m.indices)).toBeLessThan(vcount);
    expect([...m.positions].every(Number.isFinite)).toBe(true);
  });

  it('respects the radius at each point', () => {
    const m = buildTube(line, radii, 8)!;
    // first ring is around the origin with radius 0.1
    for (let j = 0; j < 8; j++) {
      const d = Math.hypot(m.positions[j * 3], m.positions[j * 3 + 1], m.positions[j * 3 + 2]);
      expect(d).toBeCloseTo(0.1, 5);
    }
  });

  it('has unit normals', () => {
    const m = buildTube(line, radii, 6)!;
    for (let i = 0; i < m.normals.length; i += 3) {
      expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1, 5);
    }
  });

  it('turns a single tap into a dot and handles duplicate points', () => {
    expect(buildTube([1, 2, 3], [0.05])).not.toBeNull();
    const dup = buildTube([1, 2, 3, 1, 2, 3, 1, 2, 3], [0.05, 0.05, 0.05])!;
    expect([...dup.positions].every(Number.isFinite)).toBe(true);
    expect(buildTube([], [])).toBeNull();
  });

  it('does not produce NaNs for a stroke going straight along the up axis', () => {
    const m = buildTube([0, 0, 0, 0, 1, 0, 0, 2, 0], [0.1, 0.1, 0.1])!;
    expect([...m.positions].every(Number.isFinite)).toBe(true);
  });
});

describe('buildRibbon', () => {
  it('lies in the drawing plane', () => {
    const flat = [0, 0, 0, 1, 0, 0, 2, 1, 0];
    const m = buildRibbon(flat, [0.1, 0.1, 0.1], [0, 0, 1])!;
    for (let i = 2; i < m.positions.length; i += 3) expect(m.positions[i]).toBeCloseTo(0, 6);
    expect(m.indices.length).toBe(2 * 6);
  });
});

describe('helpers', () => {
  it('mirrors x only', () => {
    expect(mirrorX([1, 2, 3, -4, 5, 6])).toEqual([-1, 2, 3, 4, 5, 6]);
  });
  it('maps pen pressure monotonically and ignores pressure for other pointers', () => {
    expect(pressureToScale(0.2, 'pen')).toBeLessThan(pressureToScale(0.8, 'pen'));
    expect(pressureToScale(1, 'pen')).toBeCloseTo(1);
    expect(pressureToScale(0.1, 'mouse')).toBe(pressureToScale(1, 'touch'));
  });
});
