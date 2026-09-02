import { describe, expect, it } from 'vitest';
import {
  dijkstra,
  loadGraph,
  multiSourceDijkstra,
  nearestNode,
  reverseGraph,
  type SerializedAdjacencyGraph,
} from './graph';

const graphFixture: SerializedAdjacencyGraph = {
  format: 'adjacency-v1',
  nodes: [
    [-122.4, 37.77],
    [-122.39, 37.77],
    [-122.38, 37.77],
  ],
  offsets: [0, 1, 2, 2],
  targets: [1, 2],
  weights: [4, 4],
};

describe('road graph', () => {
  it('respects direction and cutoff time', () => {
    const graph = loadGraph(graphFixture);
    const forward = dijkstra(graph, 0, 5);
    expect(forward[0]).toBe(0);
    expect(forward[1]).toBe(4);
    expect(forward[2]).toBe(Number.POSITIVE_INFINITY);

    const reverse = dijkstra(graph, 2, 20);
    expect(reverse[0]).toBe(Number.POSITIVE_INFINITY);
  });

  it('expands monotonically as the time limit increases', () => {
    const graph = loadGraph(graphFixture);
    const short = dijkstra(graph, 0, 5);
    const long = dijkstra(graph, 0, 10);
    const shortReach = [...short].filter(Number.isFinite).length;
    const longReach = [...long].filter(Number.isFinite).length;
    expect(longReach).toBeGreaterThan(shortReach);
  });

  it('snaps to the nearest graph node', () => {
    const graph = loadGraph(graphFixture);
    expect(nearestNode(graph, [-122.389, 37.7701])).toBe(1);
  });

  it('uses multi-source graph walking times and leaves a nearby disconnected node unreachable', () => {
    const walkingFixture: SerializedAdjacencyGraph = {
      format: 'adjacency-v1',
      nodes: [
        [-122.4, 37.77],
        [-122.399, 37.77],
        [-122.398, 37.77],
        [-122.4001, 37.7701],
      ],
      offsets: [0, 1, 3, 4, 4],
      targets: [1, 0, 2, 1],
      weights: [3, 3, 4, 4],
    };
    const result = multiSourceDijkstra(loadGraph(walkingFixture), [0, 2], 10, 'walk');

    expect(result.distances[1]).toBe(3);
    expect(result.owners[1]).toBe(0);
    expect(result.distances[3]).toBe(Number.POSITIVE_INFINITY);
  });

  it('does not drop fractional-weight paths because distances use Float32 storage', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => [-122.4 + index / 10_000, 37.77]) as [
      number,
      number,
    ][];
    const graph = loadGraph({
      format: 'adjacency-v1',
      nodes,
      offsets: Array.from({ length: 21 }, (_, index) => Math.min(index, 19)),
      targets: Array.from({ length: 19 }, (_, index) => index + 1),
      weights: Array.from({ length: 19 }, () => 0.123_456_789),
    });

    expect(Number.isFinite(dijkstra(graph, 0, 5)[19])).toBe(true);
  });

  it('reverses directed edges for destination-oriented commute searches', () => {
    const reversed = reverseGraph(loadGraph(graphFixture));
    const toDestination = dijkstra(reversed, 2, 20);

    expect(toDestination[0]).toBe(8);
    expect(toDestination[1]).toBe(4);
  });
});
