import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import pointOnFeature from '@turf/point-on-feature';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { Transform } from 'node:stream';

type OsmNode = { type: 'node'; id: number; lon: number; lat: number; tags: Record<string, string> };
type OsmWay = { type: 'way'; id: number; refs: number[]; tags: Record<string, string> };
type OsmItem = OsmNode | OsmWay | { type: 'relation' };
type Coordinate = [number, number];

const require = createRequire(import.meta.url);
const parseOsm = require('osm-pbf-parser') as () => Transform;
const projectRoot = resolve(import.meta.dirname, '../..');
const outputDirectory = join(projectRoot, 'public/data/sf');
const boundaryPath = join(outputDirectory, 'boundary.geojson');
const pbfPath = process.env.OSM_PBF_PATH;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
}

function distanceKm(a: Coordinate, b: Coordinate) {
  const latScale = 111.32;
  const lngScale = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)) * 111.32;
  return Math.hypot((a[0] - b[0]) * lngScale, (a[1] - b[1]) * latScale);
}

function speedFor(highway: string) {
  if (highway === 'cycleway') return 18;
  if (['primary', 'secondary', 'tertiary'].includes(highway)) return 14;
  if (['path', 'track'].includes(highway)) return 10;
  if (highway === 'service') return 12;
  return 15;
}

function isBikeWay(tags: Record<string, string>) {
  if (
    !tags.highway ||
    ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'steps'].includes(tags.highway)
  )
    return false;
  if (['no', 'private'].includes(tags.access) && tags.bicycle !== 'yes') return false;
  return tags.bicycle !== 'no';
}

async function parseGraph(filteredPbf: string) {
  const nodes = new Map<number, Coordinate>();
  const ways: OsmWay[] = [];
  const groceries: Array<{ id: string; name: string; coordinates: Coordinate; type: string }> = [];
  const parks: Array<{ id: string; name: string; coordinates: Coordinate }> = [];
  const stream = createReadStream(filteredPbf).pipe(parseOsm()) as Transform &
    AsyncIterable<OsmItem[]>;
  for await (const items of stream) {
    for (const item of items) {
      if (item.type === 'node') {
        nodes.set(item.id, [item.lon, item.lat]);
        if (item.tags.shop === 'supermarket' || item.tags.shop === 'grocery') {
          groceries.push({
            id: `osm-node-${item.id}`,
            name: item.tags.name ?? 'Unnamed grocery',
            coordinates: [item.lon, item.lat],
            type: item.tags.shop,
          });
        }
        if (item.tags.leisure === 'park')
          parks.push({
            id: `osm-node-${item.id}`,
            name: item.tags.name ?? 'Unnamed park',
            coordinates: [item.lon, item.lat],
          });
      } else if (item.type === 'way' && isBikeWay(item.tags)) {
        ways.push(item);
      }
    }
  }

  const usedNodeIds = new Set(ways.flatMap((way) => way.refs));
  const orderedIds = [...usedNodeIds].filter((nodeId) => nodes.has(nodeId));
  const indexById = new Map(orderedIds.map((nodeId, index) => [nodeId, index]));
  const adjacency: Array<Array<{ target: number; weight: number }>> = orderedIds.map(() => []);

  for (const way of ways) {
    const speed = speedFor(way.tags.highway);
    const bicycleOneWay = way.tags['oneway:bicycle'];
    const followsMotorDirection = bicycleOneWay !== 'no';
    const reverseOnly =
      followsMotorDirection && (way.tags.oneway === '-1' || bicycleOneWay === '-1');
    const forwardOnly =
      !reverseOnly &&
      followsMotorDirection &&
      (['yes', '1', 'true'].includes(way.tags.oneway) || bicycleOneWay === 'yes');
    for (let index = 0; index < way.refs.length - 1; index += 1) {
      const fromId = way.refs[index]!;
      const toId = way.refs[index + 1]!;
      const from = indexById.get(fromId);
      const to = indexById.get(toId);
      const fromCoordinate = nodes.get(fromId);
      const toCoordinate = nodes.get(toId);
      if (from === undefined || to === undefined || !fromCoordinate || !toCoordinate) continue;
      const weight = (distanceKm(fromCoordinate, toCoordinate) / speed) * 60;
      if (!reverseOnly) adjacency[from]!.push({ target: to, weight });
      if (!forwardOnly) adjacency[to]!.push({ target: from, weight });
    }
  }

  const offsets: number[] = new Array(orderedIds.length + 1).fill(0);
  const targets: number[] = [];
  const weights: number[] = [];
  adjacency.forEach((edges, node) => {
    offsets[node] = targets.length;
    for (const edge of edges) {
      targets.push(edge.target);
      weights.push(Number(edge.weight.toFixed(4)));
    }
  });
  offsets[orderedIds.length] = targets.length;
  return {
    graph: {
      format: 'adjacency-v1',
      nodes: orderedIds.map((nodeId) => nodes.get(nodeId)!),
      offsets,
      targets,
      weights,
    },
    groceries,
    parks,
  };
}

async function readAreaPlaces(geoJsonSequence: string) {
  const text = await readFile(geoJsonSequence, 'utf8');
  const parks: Array<{ id: string; name: string; coordinates: Coordinate }> = [];
  const groceries: Array<{
    id: string;
    name: string;
    coordinates: Coordinate;
    type: 'supermarket' | 'grocery';
  }> = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line) as {
      id?: string;
      properties?: Record<string, string>;
      geometry?: { type: string; coordinates: unknown };
    };
    if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) continue;
    const areaFeature: Feature<Polygon | MultiPolygon> = {
      type: 'Feature',
      properties: feature.properties ?? {},
      geometry: feature.geometry as Polygon | MultiPolygon,
    };
    const coordinates = pointOnFeature(areaFeature).geometry.coordinates as Coordinate;
    if (feature.properties?.leisure === 'park') {
      parks.push({
        id: feature.id ?? `park-${parks.length}`,
        name: feature.properties?.name ?? 'Unnamed park',
        coordinates,
      });
    }
    const shop = feature.properties?.shop;
    if (shop === 'supermarket' || shop === 'grocery') {
      groceries.push({
        id: feature.id ?? `grocery-${groceries.length}`,
        name: feature.properties?.name ?? 'Unnamed grocery',
        coordinates,
        type: shop,
      });
    }
  }
  return { parks, groceries };
}

async function main() {
  if (!pbfPath)
    throw new Error(
      'Set OSM_PBF_PATH to a pinned California .osm.pbf file. See data/source/source.json.',
    );
  run('osmium', ['--version']);
  await mkdir(outputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'groundwork-osm-'));
  try {
    const extractPath = join(temporaryDirectory, 'sf.osm.pbf');
    const filteredPath = join(temporaryDirectory, 'sf-filtered.osm.pbf');
    const areasPath = join(temporaryDirectory, 'sf-areas.geojsonseq');
    run('osmium', [
      'extract',
      '--polygon',
      boundaryPath,
      pbfPath,
      '--output',
      extractPath,
      '--overwrite',
    ]);
    run('osmium', [
      'tags-filter',
      extractPath,
      'w/highway',
      'n/shop=supermarket,grocery',
      'nwr/leisure=park',
      '--output',
      filteredPath,
      '--overwrite',
    ]);
    run('osmium', [
      'export',
      filteredPath,
      '--format',
      'geojsonseq',
      '--output',
      areasPath,
      '--overwrite',
    ]);
    const parsed = await parseGraph(filteredPath);
    const areaPlaces = await readAreaPlaces(areasPath);
    const currentPlaces = JSON.parse(
      await readFile(join(outputDirectory, 'places.json'), 'utf8'),
    ) as { presets: unknown[] };
    const graphJson = `${JSON.stringify(parsed.graph)}\n`;
    const compressedBytes = gzipSync(graphJson).byteLength;
    if (compressedBytes > 8 * 1024 * 1024)
      throw new Error(
        `Graph exceeds the 8 MB compressed budget (${(compressedBytes / 1024 / 1024).toFixed(2)} MB).`,
      );
    await writeFile(join(outputDirectory, 'graph.json'), graphJson);
    await writeFile(
      join(outputDirectory, 'places.json'),
      `${JSON.stringify({ groceries: [...parsed.groceries, ...areaPlaces.groceries], parks: [...parsed.parks, ...areaPlaces.parks], presets: currentPlaces.presets }, null, 2)}\n`,
    );
    await writeFile(
      join(outputDirectory, 'metadata.json'),
      `${JSON.stringify({ datasetVersion: `sf-osm-${new Date().toISOString().slice(0, 10)}`, generatedAt: new Date().toISOString(), coverage: 'San Francisco, California', source: 'OpenStreetMap via pinned California PBF', license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors', graphFormat: 'adjacency-v1', compressedGraphBytes: compressedBytes }, null, 2)}\n`,
    );
    process.stdout.write(
      `Generated ${orderedSummary(parsed.graph.nodes.length, parsed.graph.targets.length, parsed.groceries.length + areaPlaces.groceries.length, parsed.parks.length + areaPlaces.parks.length)}\n`,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function orderedSummary(nodes: number, edges: number, groceries: number, parks: number) {
  return `${nodes.toLocaleString()} nodes, ${edges.toLocaleString()} directed edges, ${groceries} groceries, and ${parks} parks.`;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
