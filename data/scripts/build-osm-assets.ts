import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import pointOnFeature from '@turf/point-on-feature';
import simplify from '@turf/simplify';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { carDirections, carSpeed, type OsmTags } from './routing';

type Coordinate = [number, number];
type Tags = OsmTags;
const CATEGORY_IDS = ['grocery', 'school', 'healthcare', 'park', 'cinema'] as const;
type CategoryId = (typeof CATEGORY_IDS)[number];
type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{ type: string; role: string; geometry?: Array<{ lat: number; lon: number }> }>;
  tags?: Tags;
};
type RawEdge = {
  a: number;
  b: number;
  bikeAB: number;
  bikeBA: number;
  carAB: number;
  carBA: number;
  walk: number;
  names: Set<string>;
};
type Place = {
  id: string;
  name: string;
  coordinates: Coordinate;
  accessPoints?: Coordinate[];
  type?: 'supermarket' | 'grocery' | 'convenience';
};

const projectRoot = resolve(import.meta.dirname, '../..');
const sourceDirectory = join(projectRoot, 'data/source');
const buildDate = new Date().toISOString().slice(0, 10);
const overpassUrl = 'https://overpass-api.de/api/interpreter';
const cityFlagIndex = process.argv.indexOf('--city');
const requestedCity = cityFlagIndex >= 0 ? (process.argv[cityFlagIndex + 1] ?? '') : 'sf';
const cityConfigs = {
  sf: {
    slug: 'sf',
    name: 'San Francisco',
    bbox: '37.69,-122.53,37.83,-122.34',
    osmiumBbox: '-122.53,37.69,-122.34,37.83',
    datasetVersion: `sf-osm-datasf-${buildDate}-v3`,
    maxGraphBytes: 2 * 1024 * 1024,
    neighborhoodUrl: 'https://data.sfgov.org/resource/j2bu-swwd.geojson?$limit=100',
    boundaryUrl:
      'https://data.sfgov.org/resource/wamw-vt4s.geojson?$limit=50&$where=county%3D%27San%20Francisco%27',
    extraOverpass: '',
  },
  hyderabad: {
    slug: 'hyderabad',
    name: 'Hyderabad',
    bbox: '17.20,78.29,17.56,78.67',
    osmiumBbox: '78.29,17.20,78.67,17.56',
    datasetVersion: `hyderabad-osm-${buildDate}-v3`,
    maxGraphBytes: 8 * 1024 * 1024,
    neighborhoodUrl: null,
    boundaryUrl: null,
    extraOverpass:
      'relation(7868535);\n  relation["boundary"="administrative"]["admin_level"="10"](17.20,78.29,17.56,78.67);',
  },
} as const;
if (!(requestedCity in cityConfigs)) throw new Error(`Unsupported city: ${requestedCity}`);
const city = cityConfigs[requestedCity as keyof typeof cityConfigs];
const outputDirectory = join(projectRoot, 'public/data', city.slug);
const datasetVersion = city.datasetVersion;
const overpassQuery = `[out:json][timeout:300];
(
  way["highway"](${city.bbox});
  nwr["shop"~"^(supermarket|grocery|convenience)$"](${city.bbox});
  nwr["leisure"="park"](${city.bbox});
  nwr["name"]["amenity"](${city.bbox});
  nwr["name"]["shop"](${city.bbox});
  nwr["name"]["tourism"](${city.bbox});
  nwr["name"]["leisure"](${city.bbox});
  ${city.extraOverpass}
);
out center geom;`;

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function distanceKm(a: Coordinate, b: Coordinate) {
  const latScale = 111.32;
  const lngScale = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)) * 111.32;
  return Math.hypot((a[0] - b[0]) * lngScale, (a[1] - b[1]) * latScale);
}
function bikeSpeed(tags: Tags) {
  if (tags.highway === 'cycleway') return 18;
  if (['primary', 'secondary', 'tertiary'].includes(tags.highway)) return 14;
  if (['path', 'track'].includes(tags.highway)) return 10;
  if (tags.highway === 'service') return 12;
  return 15;
}
function bikeDirections(tags: Tags): [boolean, boolean] {
  if (
    !tags.highway ||
    ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'steps'].includes(tags.highway) ||
    (['no', 'private'].includes(tags.access) && tags.bicycle !== 'yes') ||
    tags.bicycle === 'no'
  )
    return [false, false];
  const value = tags['oneway:bicycle'];
  if (value === 'no') return [true, true];
  if (value === '-1' || (tags.oneway === '-1' && value !== 'no')) return [false, true];
  if (value === 'yes' || ['yes', '1', 'true'].includes(tags.oneway)) return [true, false];
  return [true, true];
}
function isWalkable(tags: Tags) {
  if (!tags.highway || tags.foot === 'no') return false;
  if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(tags.highway))
    return tags.foot === 'yes';
  return !(['no', 'private'].includes(tags.access) && tags.foot !== 'yes');
}
const coordinateKey = ([lng, lat]: Coordinate) => `${lng.toFixed(6)},${lat.toFixed(6)}`;
const sameCoordinate = (a: Coordinate, b: Coordinate) => coordinateKey(a) === coordinateKey(b);
const geometryCoordinates = (element: OverpassElement): Coordinate[] =>
  (element.geometry ?? []).map(({ lon, lat }) => [lon, lat]);

function stitchRings(parts: Coordinate[][]): Coordinate[][] {
  const remaining = parts.filter((part) => part.length >= 2).map((part) => [...part]);
  const rings: Coordinate[][] = [];
  while (remaining.length) {
    const ring = remaining.shift()!;
    let changed = true;
    while (!sameCoordinate(ring[0]!, ring.at(-1)!) && changed) {
      changed = false;
      for (let index = 0; index < remaining.length; index += 1) {
        const part = remaining[index]!;
        if (sameCoordinate(ring.at(-1)!, part[0]!)) ring.push(...part.slice(1));
        else if (sameCoordinate(ring.at(-1)!, part.at(-1)!))
          ring.push(...part.toReversed().slice(1));
        else continue;
        remaining.splice(index, 1);
        changed = true;
        break;
      }
    }
    if (ring.length >= 4 && sameCoordinate(ring[0]!, ring.at(-1)!)) rings.push(ring);
  }
  return rings;
}

function pointOnElement(element: OverpassElement): Coordinate | null {
  if (element.type === 'node' && element.lon !== undefined && element.lat !== undefined)
    return [element.lon, element.lat];
  const direct = geometryCoordinates(element);
  const parts =
    element.type === 'relation'
      ? (element.members ?? [])
          .filter(({ role, geometry }) => role === 'outer' && geometry)
          .map(({ geometry }) => geometry!.map(({ lon, lat }) => [lon, lat] as Coordinate))
      : direct.length
        ? [direct]
        : [];
  const rings = stitchRings(parts);
  if (rings.length) {
    const polygon: Feature<Polygon | MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry:
        rings.length === 1
          ? { type: 'Polygon', coordinates: [rings[0]!] }
          : { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) },
    };
    return pointOnFeature(polygon).geometry.coordinates as Coordinate;
  }
  if (element.center) return [element.center.lon, element.center.lat];
  return direct[0] ?? null;
}

function perimeterAccessPoints(element: OverpassElement, fallback: Coordinate): Coordinate[] {
  const perimeter =
    element.type === 'relation'
      ? (element.members ?? [])
          .filter(({ role, geometry }) => role === 'outer' && geometry)
          .flatMap(({ geometry }) => geometry!.map(({ lon, lat }) => [lon, lat] as Coordinate))
      : geometryCoordinates(element);
  const unique = [
    ...new Map(perimeter.map((coordinate) => [coordinateKey(coordinate), coordinate])).values(),
  ];
  if (unique.length === 0) return [fallback];
  const maximumPoints = 12;
  const stride = Math.max(1, Math.ceil(unique.length / maximumPoints));
  return unique.filter((_, index) => index % stride === 0).slice(0, maximumPoints);
}

async function fetchPinned(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Source fetch failed (${response.status}): ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Source fetch returned no data: ${url}`);
  return bytes;
}
const commandExists = (command: string) =>
  spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function fileSha256(path: string) {
  return new Promise<string>((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}
function osmiumFeatureToElement(feature: {
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown };
}): OverpassElement | null {
  if (!feature.geometry) return null;
  const rawId = String(feature.properties?.['@id'] ?? feature.id ?? '');
  const rawType = String(feature.properties?.['@type'] ?? rawId.split('/')[0] ?? '');
  const type = rawType === 'node' || rawType === 'way' || rawType === 'relation' ? rawType : null;
  const id = Number(rawId.split('/').at(-1));
  if (!type || !Number.isFinite(id)) return null;
  const tags = Object.fromEntries(
    Object.entries(feature.properties ?? {})
      .filter(([key, value]) => !key.startsWith('@') && typeof value === 'string')
      .map(([key, value]) => [key, String(value)]),
  );
  const element: OverpassElement = { type, id, tags };
  if (feature.geometry.type === 'Point') {
    const [lon, lat] = feature.geometry.coordinates as Coordinate;
    element.lon = lon;
    element.lat = lat;
  } else if (feature.geometry.type === 'LineString') {
    element.geometry = (feature.geometry.coordinates as Coordinate[]).map(([lon, lat]) => ({
      lon,
      lat,
    }));
  } else if (feature.geometry.type === 'Polygon') {
    const ring = (feature.geometry.coordinates as Coordinate[][])[0] ?? [];
    element.geometry = ring.map(([lon, lat]) => ({ lon, lat }));
  } else if (feature.geometry.type === 'MultiPolygon') {
    element.members = (feature.geometry.coordinates as Coordinate[][][]).map((polygon) => ({
      type: 'way',
      role: 'outer',
      geometry: (polygon[0] ?? []).map(([lon, lat]) => ({ lon, lat })),
    }));
  }
  return element;
}
async function loadPbfSource(pbfPath: string) {
  const sourceUrl = process.env.OSM_PBF_SOURCE_URL?.trim();
  if (!sourceUrl)
    throw new Error(
      'Set OSM_PBF_SOURCE_URL to the exact timestamped Geofabrik URL used for OSM_PBF_PATH.',
    );
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'sweetspot-osmium-'));
  try {
    const extractPath = join(temporaryDirectory, `${city.slug}.osm.pbf`);
    const filteredPath = join(temporaryDirectory, `${city.slug}-filtered.osm.pbf`);
    const sequencePath = join(temporaryDirectory, `${city.slug}.geojsonseq`);
    run('osmium', [
      'extract',
      '--bbox',
      city.osmiumBbox,
      pbfPath,
      '--output',
      extractPath,
      '--overwrite',
    ]);
    run('osmium', [
      'tags-filter',
      extractPath,
      'w/highway',
      'nwr/shop=supermarket,grocery,convenience',
      'nwr/leisure=park',
      'nwr/name',
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
      sequencePath,
      '--overwrite',
    ]);
    const elements = (await readFile(sequencePath, 'utf8'))
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => osmiumFeatureToElement(JSON.parse(line)))
      .filter((element): element is OverpassElement => Boolean(element));
    if (!elements.length)
      throw new Error(`The osmium ${city.name} export contains no usable elements.`);
    const timestamp = run('osmium', [
      'fileinfo',
      '-g',
      'header.option.osmosis_replication_timestamp',
      pbfPath,
    ]);
    return {
      payload: { elements },
      responseBytes: new Uint8Array(),
      extractDate: timestamp.slice(0, 10) || buildDate,
      cacheName: null,
      sourceName: `Geofabrik PBF ${city.name} extract via osmium`,
      sourceUrl,
      sourceSha256: await fileSha256(pbfPath),
      querySha256: null,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
async function loadOsmSource() {
  if (process.env.OSM_PBF_PATH) {
    if (!commandExists('osmium'))
      process.stderr.write('osmium is unavailable; using the pinned Overpass fallback.\n');
    else return loadPbfSource(process.env.OSM_PBF_PATH);
  }
  const cached = (await readdir(sourceDirectory))
    .filter((name) =>
      new RegExp(`^overpass-${city.slug}-\\d{4}-\\d{2}-\\d{2}-[a-f0-9]{12}\\.json\\.gz$`, 'u').test(
        name,
      ),
    )
    .sort()
    .at(-1);
  const responseBytes = cached
    ? new Uint8Array(gunzipSync(await readFile(join(sourceDirectory, cached))))
    : await fetchPinned(overpassUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'user-agent':
            'SweetSpot dataset builder (https://github.com/bheeshm1998/groundwork-webmcp)',
        },
        body: new URLSearchParams({ data: overpassQuery }),
      });
  let cachedQuerySha256: string | null = null;
  if (cached) {
    try {
      const previousMetadata = JSON.parse(
        await readFile(join(outputDirectory, 'metadata.json'), 'utf8'),
      ) as { sources?: Array<{ cachedAs?: string; querySha256?: string | null }> };
      cachedQuerySha256 =
        previousMetadata.sources?.find(({ cachedAs }) => cachedAs === cached)?.querySha256 ?? null;
    } catch {
      // Older source caches may predate metadata; do not misattribute them to today's query.
    }
  }
  const payload = JSON.parse(new TextDecoder().decode(responseBytes)) as {
    osm3s?: { timestamp_osm_base?: string };
    elements?: OverpassElement[];
  };
  if (!payload.elements?.length) throw new Error('The Overpass extract contains no OSM elements.');
  const extractDate = payload.osm3s?.timestamp_osm_base?.slice(0, 10) ?? buildDate;
  const cacheName =
    cached ?? `overpass-${city.slug}-${extractDate}-${sha256(responseBytes).slice(0, 12)}.json.gz`;
  if (!cached)
    await writeFile(join(sourceDirectory, cacheName), gzipSync(responseBytes, { level: 9 }));
  return {
    payload,
    responseBytes,
    extractDate,
    cacheName,
    sourceName: `OpenStreetMap Overpass ${city.name} extract (osmium fallback)`,
    sourceUrl: overpassUrl,
    sourceSha256: sha256(responseBytes),
    querySha256: cached ? cachedQuerySha256 : sha256(overpassQuery),
  };
}

function buildRawNetwork(elements: OverpassElement[]) {
  const coordinates: Coordinate[] = [];
  const nodeByCoordinate = new Map<string, number>();
  const edgesByPair = new Map<string, RawEdge>();
  const streetPoints = new Map<string, { lng: number; lat: number; count: number }>();
  const node = (coordinate: Coordinate) => {
    const key = coordinateKey(coordinate);
    const existing = nodeByCoordinate.get(key);
    if (existing !== undefined) return existing;
    const index = coordinates.length;
    coordinates.push(coordinate);
    nodeByCoordinate.set(key, index);
    return index;
  };
  for (const way of elements) {
    const tags = way.tags ?? {};
    if (way.type !== 'way' || !tags.highway) continue;
    const geometry = geometryCoordinates(way);
    if (geometry.length < 2) continue;
    const [bikeForward, bikeBackward] = bikeDirections(tags);
    const [carForward, carBackward] = carDirections(tags);
    const walkable = isWalkable(tags);
    if (!bikeForward && !bikeBackward && !carForward && !carBackward && !walkable) continue;
    const bicycleSpeed = bikeSpeed(tags);
    const drivingSpeed = carSpeed(tags);
    const name = tags.name?.trim();
    if (name) {
      const sum = streetPoints.get(name) ?? { lng: 0, lat: 0, count: 0 };
      for (const [lng, lat] of geometry) {
        sum.lng += lng;
        sum.lat += lat;
        sum.count += 1;
      }
      streetPoints.set(name, sum);
    }
    for (let index = 0; index < geometry.length - 1; index += 1) {
      const fromCoordinate = geometry[index]!;
      const toCoordinate = geometry[index + 1]!;
      const from = node(fromCoordinate);
      const to = node(toCoordinate);
      if (from === to) continue;
      const a = Math.min(from, to);
      const b = Math.max(from, to);
      const key = `${a}:${b}`;
      const bikeMinutes = (distanceKm(fromCoordinate, toCoordinate) / bicycleSpeed) * 60;
      const carMinutes = (distanceKm(fromCoordinate, toCoordinate) / drivingSpeed) * 60;
      const walkMinutes = (distanceKm(fromCoordinate, toCoordinate) / 4.8) * 60;
      const followsAB = from === a;
      const bikeAB = followsAB
        ? bikeForward
          ? bikeMinutes
          : Infinity
        : bikeBackward
          ? bikeMinutes
          : Infinity;
      const bikeBA = followsAB
        ? bikeBackward
          ? bikeMinutes
          : Infinity
        : bikeForward
          ? bikeMinutes
          : Infinity;
      const carAB = followsAB
        ? carForward
          ? carMinutes
          : Infinity
        : carBackward
          ? carMinutes
          : Infinity;
      const carBA = followsAB
        ? carBackward
          ? carMinutes
          : Infinity
        : carForward
          ? carMinutes
          : Infinity;
      const existing = edgesByPair.get(key);
      if (existing) {
        existing.bikeAB = Math.min(existing.bikeAB, bikeAB);
        existing.bikeBA = Math.min(existing.bikeBA, bikeBA);
        existing.carAB = Math.min(existing.carAB, carAB);
        existing.carBA = Math.min(existing.carBA, carBA);
        existing.walk = Math.min(existing.walk, walkable ? walkMinutes : Infinity);
        if (name) existing.names.add(name);
      } else
        edgesByPair.set(key, {
          a,
          b,
          bikeAB,
          bikeBA,
          carAB,
          carBA,
          walk: walkable ? walkMinutes : Infinity,
          names: new Set(name ? [name] : []),
        });
    }
  }
  return { coordinates, edges: [...edgesByPair.values()], streetPoints };
}

function contractNetwork(coordinates: Coordinate[], edges: RawEdge[]) {
  const incidence: number[][] = coordinates.map(() => []);
  const nodeNames: Array<Set<string>> = coordinates.map(() => new Set());
  edges.forEach((edge, index) => {
    incidence[edge.a]!.push(index);
    incidence[edge.b]!.push(index);
    for (const name of edge.names) {
      nodeNames[edge.a]!.add(name);
      nodeNames[edge.b]!.add(name);
    }
  });
  const retained = new Set<number>();
  incidence.forEach((incident, node) => {
    if (incident.length !== 2) retained.add(node);
  });
  const visited = new Set<number>();
  const paths: Array<{
    from: number;
    to: number;
    bikeForward: number;
    bikeBackward: number;
    carForward: number;
    carBackward: number;
    walk: number;
  }> = [];
  const trace = (start: number, firstEdge: number) => {
    let current = start;
    let edgeIndex = firstEdge;
    let bikeForward = 0;
    let bikeBackward = 0;
    let carForward = 0;
    let carBackward = 0;
    let walk = 0;
    while (true) {
      if (visited.has(edgeIndex)) return;
      visited.add(edgeIndex);
      const edge = edges[edgeIndex]!;
      const towardB = current === edge.a;
      bikeForward += towardB ? edge.bikeAB : edge.bikeBA;
      bikeBackward += towardB ? edge.bikeBA : edge.bikeAB;
      carForward += towardB ? edge.carAB : edge.carBA;
      carBackward += towardB ? edge.carBA : edge.carAB;
      walk += edge.walk;
      const next = towardB ? edge.b : edge.a;
      if (retained.has(next)) {
        paths.push({
          from: start,
          to: next,
          bikeForward,
          bikeBackward,
          carForward,
          carBackward,
          walk,
        });
        return;
      }
      const nextEdge = incidence[next]!.find((candidate) => candidate !== edgeIndex);
      if (nextEdge === undefined) {
        retained.add(next);
        paths.push({
          from: start,
          to: next,
          bikeForward,
          bikeBackward,
          carForward,
          carBackward,
          walk,
        });
        return;
      }
      current = next;
      edgeIndex = nextEdge;
    }
  };
  for (const start of [...retained])
    for (const edgeIndex of incidence[start]!) if (!visited.has(edgeIndex)) trace(start, edgeIndex);
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1)
    if (!visited.has(edgeIndex)) {
      const start = edges[edgeIndex]!.a;
      retained.add(start);
      trace(start, edgeIndex);
    }
  const retainedNodes = [...retained].sort((a, b) => a - b);
  const compactIndex = new Map(retainedNodes.map((node, index) => [node, index]));
  const adjacency: Array<Array<{ target: number; bike: number; walk: number; car: number }>> =
    retainedNodes.map(() => []);
  for (const path of paths) {
    const from = compactIndex.get(path.from);
    const to = compactIndex.get(path.to);
    if (from === undefined || to === undefined || from === to) continue;
    if (
      Number.isFinite(path.bikeForward) ||
      Number.isFinite(path.carForward) ||
      Number.isFinite(path.walk)
    )
      adjacency[from]!.push({
        target: to,
        bike: path.bikeForward,
        car: path.carForward,
        walk: path.walk,
      });
    if (
      Number.isFinite(path.bikeBackward) ||
      Number.isFinite(path.carBackward) ||
      Number.isFinite(path.walk)
    )
      adjacency[to]!.push({
        target: from,
        bike: path.bikeBackward,
        car: path.carBackward,
        walk: path.walk,
      });
  }
  const offsets = new Uint32Array(retainedNodes.length + 1);
  const targets: number[] = [];
  const bikeWeights: number[] = [];
  const walkWeights: number[] = [];
  const carWeights: number[] = [];
  adjacency.forEach((list, index) => {
    offsets[index] = targets.length;
    for (const edge of list) {
      targets.push(edge.target);
      bikeWeights.push(edge.bike);
      walkWeights.push(edge.walk);
      carWeights.push(edge.car);
    }
  });
  offsets[retainedNodes.length] = targets.length;
  return {
    nodes: retainedNodes.map((node) => coordinates[node]!),
    nodeLabels: retainedNodes.map((node) => {
      const names = [...nodeNames[node]!].sort();
      return names.length >= 2 ? `${names[0]} & ${names[1]}` : (names[0] ?? null);
    }),
    offsets,
    targets: Uint32Array.from(targets),
    bikeWeights: Float32Array.from(bikeWeights),
    walkWeights: Float32Array.from(walkWeights),
    carWeights: Float32Array.from(carWeights),
  };
}

function encodeGraph(graph: ReturnType<typeof contractNetwork>) {
  const nodeCount = graph.nodes.length,
    edgeCount = graph.targets.length;
  const buffer = new ArrayBuffer(12 + nodeCount * 8 + (nodeCount + 1) * 4 + edgeCount * 10);
  const view = new DataView(buffer);
  [...new TextEncoder().encode('GWG3')].forEach((byte, index) => view.setUint8(index, byte));
  view.setUint32(4, nodeCount, true);
  view.setUint32(8, edgeCount, true);
  let cursor = 12;
  for (const [lng, lat] of graph.nodes) {
    view.setInt32(cursor, Math.round(lng * 1e6), true);
    view.setInt32(cursor + 4, Math.round(lat * 1e6), true);
    cursor += 8;
  }
  for (const value of graph.offsets) {
    view.setUint32(cursor, value, true);
    cursor += 4;
  }
  for (const value of graph.targets) {
    view.setUint32(cursor, value, true);
    cursor += 4;
  }
  const encodedWeight = (value: number) =>
    Number.isFinite(value) ? Math.min(65_534, Math.round(value * 100)) : 65_535;
  for (const value of graph.bikeWeights) {
    view.setUint16(cursor, encodedWeight(value), true);
    cursor += 2;
  }
  for (const value of graph.walkWeights) {
    view.setUint16(cursor, encodedWeight(value), true);
    cursor += 2;
  }
  for (const value of graph.carWeights) {
    view.setUint16(cursor, encodedWeight(value), true);
    cursor += 2;
  }
  return new Uint8Array(buffer);
}

function buildPlaces(elements: OverpassElement[]) {
  const categories: Record<CategoryId, Place[]> = {
    grocery: [],
    school: [],
    healthcare: [],
    park: [],
    cinema: [],
  };
  const search: Array<{ id: string; label: string; coordinates: Coordinate; kind: string }> = [];
  const seen = new Set<string>();
  for (const element of elements) {
    const tags = element.tags ?? {},
      name = tags.name?.trim(),
      coordinate = pointOnElement(element);
    if (!coordinate || !name) continue;
    const id = `osm-${element.type}-${element.id}`,
      shop = tags.shop;
    if (['supermarket', 'grocery', 'convenience'].includes(shop)) {
      categories.grocery.push({
        id,
        name,
        coordinates: coordinate,
        type: shop as Place['type'],
      });
    }
    const amenityCategory =
      tags.amenity === 'school'
        ? 'school'
        : ['hospital', 'clinic', 'pharmacy'].includes(tags.amenity)
          ? 'healthcare'
          : tags.amenity === 'cinema'
            ? 'cinema'
            : null;
    if (amenityCategory) {
      categories[amenityCategory].push({
        id,
        name,
        coordinates: coordinate,
        accessPoints:
          element.type !== 'node' && ['school', 'healthcare'].includes(amenityCategory)
            ? perimeterAccessPoints(element, coordinate)
            : undefined,
      });
    }
    if (tags.leisure === 'park') {
      categories.park.push({
        id,
        name,
        coordinates: coordinate,
        accessPoints: perimeterAccessPoints(element, coordinate),
      });
    }
    if (tags.highway) continue;
    const key = `${name.toLowerCase()}:${coordinateKey(coordinate)}`;
    if (!seen.has(key)) {
      seen.add(key);
      search.push({ id, label: name, coordinates: coordinate, kind: 'poi' });
    }
  }
  const emptyCategories = CATEGORY_IDS.filter((category) => categories[category].length === 0);
  if (emptyCategories.length) {
    throw new Error(
      `The real OSM extract did not contain named places for: ${emptyCategories.join(', ')}.`,
    );
  }
  return { categories, search };
}
function parseFeatureCollection(bytes: Uint8Array) {
  const collection = JSON.parse(new TextDecoder().decode(bytes)) as FeatureCollection<
    Polygon | MultiPolygon
  >;
  if (!collection.features?.length) throw new Error('A DataSF boundary source was empty.');
  return collection;
}

function areaFeatureFromElement(
  element: OverpassElement,
  properties: Record<string, unknown>,
): Feature<Polygon | MultiPolygon> | null {
  const parts =
    element.type === 'relation'
      ? (element.members ?? [])
          .filter(({ role, geometry }) => role === 'outer' && geometry)
          .map(({ geometry }) => geometry!.map(({ lon, lat }) => [lon, lat] as Coordinate))
      : geometryCoordinates(element).length
        ? [geometryCoordinates(element)]
        : [];
  const rings = stitchRings(parts);
  if (!rings.length) return null;
  return {
    type: 'Feature',
    properties,
    geometry:
      rings.length === 1
        ? { type: 'Polygon', coordinates: [rings[0]!] }
        : { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) },
  };
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(sourceDirectory, { recursive: true });
  const osm = await loadOsmSource();
  let neighborhoods: FeatureCollection<Polygon | MultiPolygon>;
  let boundaryFeature: Feature<Polygon | MultiPolygon> | undefined;
  let neighborhoodBytes: Uint8Array | null = null;
  let boundaryBytes: Uint8Array | null = null;
  if (city.slug === 'sf') {
    [neighborhoodBytes, boundaryBytes] = await Promise.all([
      fetchPinned(city.neighborhoodUrl),
      fetchPinned(city.boundaryUrl),
    ]);
    neighborhoods = parseFeatureCollection(neighborhoodBytes);
    const boundaryCollection = parseFeatureCollection(boundaryBytes);
    boundaryFeature = boundaryCollection.features.find(
      (feature) => feature.properties?.county === 'San Francisco',
    );
    if (!boundaryFeature)
      throw new Error('DataSF did not return the San Francisco county polygon.');
  } else {
    const boundaryElement = osm.payload.elements!.find(
      (element) => element.type === 'relation' && element.id === 7868535,
    );
    boundaryFeature = boundaryElement
      ? (areaFeatureFromElement(boundaryElement, {
          name: 'Hyderabad',
          source: boundaryElement.tags?.source,
        }) ?? undefined)
      : undefined;
    neighborhoods = {
      type: 'FeatureCollection',
      features: osm.payload
        .elements!.filter(
          (element) =>
            element.type === 'relation' &&
            element.tags?.boundary === 'administrative' &&
            element.tags?.admin_level === '10' &&
            Boolean(element.tags.name),
        )
        .map((element) =>
          areaFeatureFromElement(element, {
            nhood: element.tags!.name!.replace(/^Ward \d+\s*/u, ''),
            name: element.tags!.name,
            source: element.tags!.source,
          }),
        )
        .filter((feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature)),
    };
    if (!boundaryFeature)
      throw new Error('OpenStreetMap did not return the Hyderabad city polygon.');
    if (neighborhoods.features.length < 50)
      throw new Error('OpenStreetMap returned too few Hyderabad ward polygons.');
  }
  const network = buildRawNetwork(osm.payload.elements!),
    graph = contractNetwork(network.coordinates, network.edges);
  if (graph.nodes.length < 1000 || graph.targets.length < 2000)
    throw new Error('The extracted street graph is unexpectedly small.');
  const compressedGraph = gzipSync(encodeGraph(graph), { level: 9 });
  if (compressedGraph.byteLength >= city.maxGraphBytes)
    throw new Error(
      `Graph exceeds ${(city.maxGraphBytes / 1024 / 1024).toFixed(0)} MB gzipped (${(compressedGraph.byteLength / 1024 / 1024).toFixed(2)} MB).`,
    );
  const places = buildPlaces(osm.payload.elements!);
  for (const [name, sum] of network.streetPoints)
    places.search.push({
      id: `osm-street-${sha256(name).slice(0, 16)}`,
      label: name,
      coordinates: [sum.lng / sum.count, sum.lat / sum.count],
      kind: 'street',
    });
  places.search.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const graphFile = `graph-${datasetVersion}.bin.gz`,
    placesFile = `places-${datasetVersion}.json`,
    neighborhoodsFile = `neighborhoods-${datasetVersion}.geojson`,
    boundaryFile = `boundary-${datasetVersion}.geojson`,
    labelsFile = `node-labels-${datasetVersion}.json`;
  const simplifiedNeighborhoods = {
    ...neighborhoods,
    features: neighborhoods.features.map((feature) =>
      simplify(feature, { tolerance: 0.00002, highQuality: true }),
    ),
  };
  const metadata = {
    datasetVersion,
    generatedAt: new Date().toISOString(),
    coverage:
      city.slug === 'sf'
        ? 'City and County of San Francisco, California'
        : 'Hyderabad, Telangana, India',
    attribution: '© OpenStreetMap contributors',
    license: city.slug === 'sf' ? 'ODbL 1.0 (OSM); PDDL 1.0 (DataSF)' : 'ODbL 1.0 (OSM)',
    graphFormat: 'sweetspot-graph-v3',
    method:
      'Contracted street graph with destination-oriented bicycle, pedestrian, and free-flow driving times, plus sampled perimeter access for mapped areas.',
    assets: {
      graph: graphFile,
      places: placesFile,
      neighborhoods: neighborhoodsFile,
      boundary: boundaryFile,
      nodeLabels: labelsFile,
    },
    counts: {
      graphNodes: graph.nodes.length,
      directedEdges: graph.targets.length,
      places: Object.fromEntries(
        CATEGORY_IDS.map((category) => [category, places.categories[category].length]),
      ),
      searchEntries: places.search.length,
      neighborhoods: neighborhoods.features.length,
    },
    compressedGraphBytes: compressedGraph.byteLength,
    sources: [
      {
        name: osm.sourceName,
        url: osm.sourceUrl,
        extractDate: osm.extractDate,
        sha256: osm.sourceSha256,
        querySha256: osm.querySha256,
        cachedAs: osm.cacheName,
      },
      ...(city.slug === 'sf' && neighborhoodBytes && boundaryBytes
        ? [
            {
              name: 'DataSF Analysis Neighborhoods (j2bu-swwd)',
              url: city.neighborhoodUrl,
              extractDate: buildDate,
              sha256: sha256(neighborhoodBytes),
            },
            {
              name: 'DataSF Bay Area County Polygons (wamw-vt4s), San Francisco filter',
              url: city.boundaryUrl,
              extractDate: buildDate,
              sha256: sha256(boundaryBytes),
            },
          ]
        : [
            {
              name: 'OpenStreetMap Hyderabad administrative boundary and GHMC wards',
              url: overpassUrl,
              extractDate: osm.extractDate,
              sha256: osm.sourceSha256,
            },
          ]),
    ],
  };
  await Promise.all([
    writeFile(join(outputDirectory, graphFile), compressedGraph),
    writeFile(join(outputDirectory, placesFile), `${JSON.stringify(places)}\n`),
    writeFile(
      join(outputDirectory, neighborhoodsFile),
      `${JSON.stringify(simplifiedNeighborhoods)}\n`,
    ),
    writeFile(join(outputDirectory, boundaryFile), `${JSON.stringify(boundaryFeature)}\n`),
    writeFile(join(outputDirectory, labelsFile), `${JSON.stringify(graph.nodeLabels)}\n`),
    writeFile(join(outputDirectory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`),
  ]);
  process.stdout.write(
    `${JSON.stringify(metadata.counts)}\nGraph: ${compressedGraph.byteLength} bytes gzipped\n`,
  );
}
main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
