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
  bikeWeights: Float32Array;
  walkWeights: Float32Array;
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
    bikeWeights: weights,
    walkWeights: Float32Array.from(weights, (weight) => weight * (spec.bikeSpeedKph / 4.8)),
  };
}

export function loadGraph(spec: SerializedGraph): GraphData {
  if (spec.format === 'compact-grid-v1') return expandCompactGraph(spec);
  return {
    lng: Float64Array.from(spec.nodes.map(([lng]) => lng)),
    lat: Float64Array.from(spec.nodes.map(([, lat]) => lat)),
    offsets: Uint32Array.from(spec.offsets),
    targets: Uint32Array.from(spec.targets),
    bikeWeights: Float32Array.from(spec.weights),
    walkWeights: Float32Array.from(spec.weights),
  };
}

export function decodeGraphBinary(bytes: Uint8Array): GraphData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== 'GWG2') throw new Error('Unsupported SweetSpot graph binary.');
  const nodeCount = view.getUint32(4, true);
  const edgeCount = view.getUint32(8, true);
  const expectedBytes = 12 + nodeCount * 8 + (nodeCount + 1) * 4 + edgeCount * 8;
  if (bytes.byteLength !== expectedBytes)
    throw new Error('The SweetSpot graph binary is truncated.');
  const lng = new Float64Array(nodeCount);
  const lat = new Float64Array(nodeCount);
  let cursor = 12;
  for (let index = 0; index < nodeCount; index += 1) {
    lng[index] = view.getInt32(cursor, true) / 1_000_000;
    lat[index] = view.getInt32(cursor + 4, true) / 1_000_000;
    cursor += 8;
  }
  const offsets = new Uint32Array(nodeCount + 1);
  for (let index = 0; index <= nodeCount; index += 1) {
    offsets[index] = view.getUint32(cursor, true);
    cursor += 4;
  }
  const targets = new Uint32Array(edgeCount);
  for (let index = 0; index < edgeCount; index += 1) {
    targets[index] = view.getUint32(cursor, true);
    cursor += 4;
  }
  const decodeWeight = (value: number) =>
    value === 65_535 ? Number.POSITIVE_INFINITY : value / 100;
  const bikeWeights = new Float32Array(edgeCount);
  const walkWeights = new Float32Array(edgeCount);
  for (let index = 0; index < edgeCount; index += 1) {
    bikeWeights[index] = decodeWeight(view.getUint16(cursor, true));
    cursor += 2;
  }
  for (let index = 0; index < edgeCount; index += 1) {
    walkWeights[index] = decodeWeight(view.getUint16(cursor, true));
    cursor += 2;
  }
  return { lng, lat, offsets, targets, bikeWeights, walkWeights };
}

export function nearestNode(graph: GraphData, coordinate: Coordinate): number {
  return nearestNodeForMode(graph, coordinate);
}

export function nearestNodeForMode(
  graph: GraphData,
  coordinate: Coordinate,
  mode?: TravelMode,
): number {
  let closest = 0;
  let closestSquared = Number.POSITIVE_INFINITY;
  const lngScale = Math.cos(coordinate[1] * (Math.PI / 180));
  for (let index = 0; index < graph.lng.length; index += 1) {
    if (mode) {
      const weights = mode === 'bike' ? graph.bikeWeights : graph.walkWeights;
      let eligible = false;
      for (let edge = graph.offsets[index]!; edge < graph.offsets[index + 1]!; edge += 1) {
        if (Number.isFinite(weights[edge]!)) {
          eligible = true;
          break;
        }
      }
      if (!eligible) continue;
    }
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

export type TravelMode = 'bike' | 'walk';

export function multiSourceDijkstra(
  graph: GraphData,
  origins: number[],
  cutoffMinutes: number,
  mode: TravelMode,
): { distances: Float32Array; owners: Int32Array } {
  const distances = new Float32Array(graph.lng.length).fill(Number.POSITIVE_INFINITY);
  const owners = new Int32Array(graph.lng.length).fill(-1);
  const queue = new MinHeap();
  origins.forEach((origin, owner) => {
    if (distances[origin] === 0) return;
    distances[origin] = 0;
    owners[origin] = owner;
    queue.push([0, origin]);
  });
  const weights = mode === 'bike' ? graph.bikeWeights : graph.walkWeights;

  while (queue.size > 0) {
    const item = queue.pop();
    if (!item) break;
    const [distance, node] = item;
    if (distance > cutoffMinutes || distance > distances[node]!) continue;
    for (let edge = graph.offsets[node]!; edge < graph.offsets[node + 1]!; edge += 1) {
      const target = graph.targets[edge]!;
      const weight = weights[edge]!;
      if (!Number.isFinite(weight)) continue;
      const next = distance + weight;
      if (next <= cutoffMinutes && next < distances[target]!) {
        distances[target] = next;
        owners[target] = owners[node]!;
        queue.push([next, target]);
      }
    }
  }
  return { distances, owners };
}

export function dijkstra(
  graph: GraphData,
  origin: number,
  cutoffMinutes: number,
  mode: TravelMode = 'bike',
): Float32Array {
  return multiSourceDijkstra(graph, [origin], cutoffMinutes, mode).distances;
}
