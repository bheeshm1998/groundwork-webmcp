import type { Coordinate } from '../domain/schemas';

export interface CompactGraphSpec {
  format: 'compact-grid-v1';
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  columns: number;
  rows: number;
  bikeSpeedKph: number;
  blocked: number[];
}

export interface GraphData {
  lng: Float64Array;
  lat: Float64Array;
  offsets: Uint32Array;
  targets: Uint32Array;
  weights: Float32Array;
}

export interface SerializedAdjacencyGraph {
  format: 'adjacency-v1';
  nodes: Coordinate[];
  offsets: number[];
  targets: number[];
  weights: number[];
}

export type SerializedGraph = CompactGraphSpec | SerializedAdjacencyGraph;

function distanceKm(a: Coordinate, b: Coordinate): number {
  const latScale = 111.32;
  const lngScale = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)) * 111.32;
  return Math.hypot((a[0] - b[0]) * lngScale, (a[1] - b[1]) * latScale);
}

export function expandCompactGraph(spec: CompactGraphSpec): GraphData {
  const blocked = new Set(spec.blocked);
  const indexMap = new Int32Array(spec.columns * spec.rows).fill(-1);
  const coordinates: Coordinate[] = [];

  for (let row = 0; row < spec.rows; row += 1) {
    for (let column = 0; column < spec.columns; column += 1) {
      const sourceIndex = row * spec.columns + column;
      if (blocked.has(sourceIndex)) continue;
      indexMap[sourceIndex] = coordinates.length;
      coordinates.push([
        spec.minLng + (column / (spec.columns - 1)) * (spec.maxLng - spec.minLng),
        spec.minLat + (row / (spec.rows - 1)) * (spec.maxLat - spec.minLat),
      ]);
    }
  }

  const adjacency: Array<Array<{ target: number; weight: number }>> = coordinates.map(() => []);
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
  ] as const;

  for (let row = 0; row < spec.rows; row += 1) {
    for (let column = 0; column < spec.columns; column += 1) {
      const sourceGridIndex = row * spec.columns + column;
      const source = indexMap[sourceGridIndex] ?? -1;
      if (source < 0) continue;
      for (const [dx, dy] of directions) {
        const targetColumn = column + dx;
        const targetRow = row + dy;
        if (
          targetColumn < 0 ||
          targetColumn >= spec.columns ||
          targetRow < 0 ||
          targetRow >= spec.rows
        ) {
          continue;
        }
        const target = indexMap[targetRow * spec.columns + targetColumn] ?? -1;
        if (target < 0) continue;
        const sourceCoordinate = coordinates[source];
        const targetCoordinate = coordinates[target];
        if (!sourceCoordinate || !targetCoordinate) continue;
        const speedFactor = row % 5 === 0 && dx < 0 ? 0.78 : 1;
        const minutes =
          (distanceKm(sourceCoordinate, targetCoordinate) / (spec.bikeSpeedKph * speedFactor)) * 60;
        adjacency[source]?.push({ target, weight: minutes });
      }
    }
  }

  const edgeCount = adjacency.reduce((sum, edges) => sum + edges.length, 0);
  const offsets = new Uint32Array(coordinates.length + 1);
  const targets = new Uint32Array(edgeCount);
  const weights = new Float32Array(edgeCount);
  let cursor = 0;
  adjacency.forEach((edges, node) => {
    offsets[node] = cursor;
    for (const edge of edges) {
      targets[cursor] = edge.target;
      weights[cursor] = edge.weight;
      cursor += 1;
    }
  });
  offsets[coordinates.length] = cursor;

  return {
    lng: Float64Array.from(coordinates.map(([lng]) => lng)),
    lat: Float64Array.from(coordinates.map(([, lat]) => lat)),
    offsets,
    targets,
    weights,
  };
}

export function loadGraph(spec: SerializedGraph): GraphData {
  if (spec.format === 'compact-grid-v1') return expandCompactGraph(spec);
  return {
    lng: Float64Array.from(spec.nodes.map(([lng]) => lng)),
    lat: Float64Array.from(spec.nodes.map(([, lat]) => lat)),
    offsets: Uint32Array.from(spec.offsets),
    targets: Uint32Array.from(spec.targets),
    weights: Float32Array.from(spec.weights),
  };
}

export function nearestNode(graph: GraphData, coordinate: Coordinate): number {
  let closest = 0;
  let closestSquared = Number.POSITIVE_INFINITY;
  const lngScale = Math.cos(coordinate[1] * (Math.PI / 180));
  for (let index = 0; index < graph.lng.length; index += 1) {
    const dx = (graph.lng[index]! - coordinate[0]) * lngScale;
    const dy = graph.lat[index]! - coordinate[1];
    const squared = dx * dx + dy * dy;
    if (squared < closestSquared) {
      closestSquared = squared;
      closest = index;
    }
  }
  return closest;
}

class MinHeap {
  private values: Array<[number, number]> = [];

  push(item: [number, number]) {
    this.values.push(item);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent]![0] <= item[0]) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = item;
  }

  pop(): [number, number] | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      let child = left;
      if (right < this.values.length && this.values[right]![0] < this.values[left]![0])
        child = right;
      if (this.values[child]![0] >= last[0]) break;
      this.values[index] = this.values[child]!;
      index = child;
    }
    this.values[index] = last;
    return first;
  }

  get size() {
    return this.values.length;
  }
}

export function dijkstra(graph: GraphData, origin: number, cutoffMinutes: number): Float32Array {
  const distances = new Float32Array(graph.lng.length).fill(Number.POSITIVE_INFINITY);
  distances[origin] = 0;
  const queue = new MinHeap();
  queue.push([0, origin]);

  while (queue.size > 0) {
    const item = queue.pop();
    if (!item) break;
    const [distance, node] = item;
    if (distance > cutoffMinutes || distance > distances[node]!) continue;
    for (let edge = graph.offsets[node]!; edge < graph.offsets[node + 1]!; edge += 1) {
      const target = graph.targets[edge]!;
      const next = distance + graph.weights[edge]!;
      if (next <= cutoffMinutes && next < distances[target]!) {
        distances[target] = next;
        queue.push([next, target]);
      }
    }
  }
  return distances;
}
