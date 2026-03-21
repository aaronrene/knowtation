/**
 * Minimal k-means for embedding vectors (Issue #1 Phase C8).
 */

function distSq(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function mean(vectors) {
  if (!vectors.length) return [];
  const dim = vectors[0].length;
  const acc = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) acc[i] += v[i] || 0;
  }
  return acc.map((x) => x / vectors.length);
}

/**
 * @param {{ id: string, vector: number[] }[]} points
 * @param {number} k
 * @param {number} maxIter
 * @returns {{ labels: number[], centroids: number[][] }}
 */
export function kmeans(points, k, maxIter = 25) {
  if (!points.length || k < 1) return { labels: [], centroids: [] };
  k = Math.min(k, points.length);
  const dim = points[0].vector.length;
  const centroids = [];
  const step = Math.max(1, Math.floor(points.length / k));
  for (let c = 0; c < k; c++) {
    centroids.push([...points[(c * step) % points.length].vector]);
  }

  const labels = new Array(points.length).fill(0);

  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = distSq(points[i].vector, centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        changed = true;
      }
    }
    const groups = Array.from({ length: k }, () => []);
    for (let i = 0; i < points.length; i++) {
      groups[labels[i]].push(points[i].vector);
    }
    for (let c = 0; c < k; c++) {
      if (groups[c].length) centroids[c] = mean(groups[c]);
    }
    if (!changed) break;
  }

  return { labels, centroids };
}
