import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { MaplibreTerradrawControl } from '@watergis/maplibre-gl-terradraw';
import '@watergis/maplibre-gl-terradraw/dist/maplibre-gl-terradraw.css';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { AreaGeometry, WorkspaceCommand } from '../domain/schemas';
import { workspaceService } from '../domain/workspace-service';
import { cancelPreferenceDraw, completePreferenceDraw } from './drawing';
import { useWorkspaceStore } from '../store/workspace-store';
import { workspaceSnapshot } from '../store/workspace-store';
import type { CanonicalWorkspace, DerivedAnalysis } from '../domain/schemas';
import { CITIES } from '../domain/cities';

maplibregl.setWorkerUrl(workerUrl);

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] };

function setSourceData(map: MapLibreMap, source: string, data: FeatureCollection | AreaGeometry) {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

const FALLBACK_MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';

function getMapStyle(): string {
  const key = import.meta.env.VITE_MAPTILER_KEY;
  return key
    ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`
    : FALLBACK_MAP_STYLE;
}

function syncWorkspaceSources(
  map: MapLibreMap,
  canonical: CanonicalWorkspace,
  derived: DerivedAnalysis,
) {
  const features: AreaGeometry[] = [];
  for (const condition of canonical.conditions) {
    if (!condition.visible) continue;
    const layer = derived.layers[condition.id];
    if (layer) {
      features.push({
        ...layer,
        properties: {
          ...layer.properties,
          conditionId: condition.id,
          kind:
            condition.kind === 'access'
              ? condition.category
              : condition.kind === 'travel'
                ? condition.mode
                : condition.kind,
        },
      });
    }
  }
  setSourceData(map, 'sweetspot-conditions', { type: 'FeatureCollection', features });
  setSourceData(map, 'sweetspot-feasible', derived.feasibleRegion ?? EMPTY_COLLECTION);
  const candidateFeatures: Array<Feature<Point>> = derived.candidates.map((candidate, index) => ({
    type: 'Feature',
    properties: {
      candidateId: candidate.id,
      rank: String(index + 1),
      selected: canonical.selectedCandidateId === candidate.id,
    },
    geometry: { type: 'Point', coordinates: candidate.coordinates },
  }));
  setSourceData(map, 'sweetspot-candidates', {
    type: 'FeatureCollection',
    features: candidateFeatures,
  });
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const destinationMarkersRef = useRef(new Map<string, Marker>());
  const drawControlRef = useRef<MaplibreTerradrawControl | null>(null);
  const drawnPreferenceIdRef = useRef<string | number | null>(null);
  const syncingDrawRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [drawReadyVersion, setDrawReadyVersion] = useState(0);
  const canonical = useWorkspaceStore((state) => state.canonical);
  const destinations = useWorkspaceStore((state) => state.canonical.destinations);
  const derived = useWorkspaceStore((state) => state.derived);
  const cityId = useWorkspaceStore((state) => state.cityId);
  const city = CITIES[cityId];
  const initialViewRef = useRef(canonical.view);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const destinationMarkers = destinationMarkersRef.current;
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: getMapStyle(),
        center: initialViewRef.current.center,
        zoom: initialViewRef.current.zoom,
        bearing: initialViewRef.current.bearing,
        pitch: initialViewRef.current.pitch,
        attributionControl: false,
        maxBounds: city.mapBounds,
      });
    } catch {
      setMapError('The interactive map could not start in this browser.');
      return;
    }
    setMapError(null);
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: `Analysis and map data © OpenStreetMap contributors (ODbL) · ${city.neighborhoodAttribution}`,
      }),
      'bottom-right',
    );

    const drawControl = new MaplibreTerradrawControl({
      modes: ['render', 'polygon', 'select', 'delete-selection', 'delete'],
      open: false,
    });
    drawControlRef.current = drawControl;
    map.addControl(drawControl, 'bottom-left');

    let attemptedFallbackStyle = !import.meta.env.VITE_MAPTILER_KEY;
    const onMapError = () => {
      if (map.isStyleLoaded()) return;
      if (!attemptedFallbackStyle) {
        attemptedFallbackStyle = true;
        map.setStyle(FALLBACK_MAP_STYLE);
        return;
      }
      setMapError('The base map could not be loaded.');
    };
    map.on('error', onMapError);

    map.on('load', () => {
      setMapError(null);
      const readyDraw = drawControl.getTerraDrawInstance();
      if (readyDraw && !readyDraw.enabled) readyDraw.start();
      useWorkspaceStore.getState().commit({ drawingReady: Boolean(readyDraw?.enabled) });
      map.addSource('sweetspot-conditions', { type: 'geojson', data: EMPTY_COLLECTION });
      map.addLayer({
        id: 'sweetspot-condition-fill',
        type: 'fill',
        source: 'sweetspot-conditions',
        paint: {
          'fill-color': [
            'match',
            ['get', 'kind'],
            'bike',
            '#29d3d1',
            'walk',
            '#58a8ff',
            'car',
            '#ff7657',
            'grocery',
            '#f0a43c',
            'school',
            '#aa8ff3',
            'healthcare',
            '#ff6f91',
            'park',
            '#5cc47b',
            'cinema',
            '#ffc857',
            '#aa8ff3',
          ],
          'fill-opacity': 0.22,
        },
      });
      map.addLayer({
        id: 'sweetspot-condition-line',
        type: 'line',
        source: 'sweetspot-conditions',
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'bike',
            '#29d3d1',
            'walk',
            '#58a8ff',
            'car',
            '#ff7657',
            'grocery',
            '#f0a43c',
            'school',
            '#aa8ff3',
            'healthcare',
            '#ff6f91',
            'park',
            '#5cc47b',
            'cinema',
            '#ffc857',
            '#aa8ff3',
          ],
          'line-width': 2,
        },
      });
      map.addSource('sweetspot-feasible', { type: 'geojson', data: EMPTY_COLLECTION });
      map.addLayer({
        id: 'sweetspot-feasible-fill',
        type: 'fill',
        source: 'sweetspot-feasible',
        paint: { 'fill-color': '#d9ff5a', 'fill-opacity': 0.42 },
      });
      map.addLayer({
        id: 'sweetspot-feasible-line',
        type: 'line',
        source: 'sweetspot-feasible',
        paint: { 'line-color': '#efffa8', 'line-width': 3, 'line-dasharray': [2, 1] },
      });
      map.addSource('sweetspot-candidates', { type: 'geojson', data: EMPTY_COLLECTION });
      map.addLayer({
        id: 'sweetspot-candidate-points',
        type: 'circle',
        source: 'sweetspot-candidates',
        paint: {
          'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 13, 10],
          'circle-color': ['case', ['boolean', ['get', 'selected'], false], '#d9ff5a', '#102d2b'],
          'circle-stroke-color': '#f5ffe1',
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: 'sweetspot-candidate-labels',
        type: 'symbol',
        source: 'sweetspot-candidates',
        layout: { 'text-field': ['get', 'rank'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] },
        paint: {
          'text-color': ['case', ['boolean', ['get', 'selected'], false], '#102d2b', '#f5ffe1'],
        },
      });
      map.on('click', 'sweetspot-candidate-points', (event: MapLayerMouseEvent) => {
        const candidateId = event.features?.[0]?.properties?.candidateId as string | undefined;
        if (candidateId)
          void workspaceService.execute({ type: 'select-candidate', id: candidateId });
      });
      const current = workspaceSnapshot();
      syncWorkspaceSources(map, current.canonical, current.derived);
      setDrawReadyVersion((version) => version + 1);
    });

    const onMoveEnd = () => {
      const center = map.getCenter();
      void workspaceService.execute({
        type: 'set-view',
        view: {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        },
      });
    };
    map.on('moveend', onMoveEnd);

    const onStartDraw = () => {
      const draw = drawControl.getTerraDrawInstance();
      if (!draw) return;
      syncingDrawRef.current = true;
      draw.clear();
      syncingDrawRef.current = false;
      drawnPreferenceIdRef.current = null;
      draw.setMode('polygon');
    };
    const onCancelDraw = () => {
      const draw = drawControl.getTerraDrawInstance();
      if (!draw) return;
      syncingDrawRef.current = true;
      draw.clear();
      syncingDrawRef.current = false;
      drawnPreferenceIdRef.current = null;
      draw.setMode('render');
      setDrawReadyVersion((version) => version + 1);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && workspaceSnapshot().operation === 'drawing') {
        cancelPreferenceDraw();
      }
    };
    window.addEventListener('sweetspot:start-draw', onStartDraw);
    window.addEventListener('sweetspot:cancel-draw', onCancelDraw);
    window.addEventListener('keydown', onKeyDown);

    const draw = drawControl.getTerraDrawInstance();
    let pendingPreferenceCommand: WorkspaceCommand | null = null;
    let processingPreferenceCommand = false;
    const waitUntilMutable = () =>
      new Promise<void>((resolve) => {
        if (!['calculating', 'drawing'].includes(workspaceSnapshot().operation)) {
          resolve();
          return;
        }
        const unsubscribe = useWorkspaceStore.subscribe((state) => {
          if (!['calculating', 'drawing'].includes(state.operation)) {
            unsubscribe();
            resolve();
          }
        });
      });
    const queuePreferenceCommand = (command: WorkspaceCommand) => {
      pendingPreferenceCommand = command;
      if (processingPreferenceCommand) return;
      processingPreferenceCommand = true;
      void (async () => {
        while (pendingPreferenceCommand) {
          await waitUntilMutable();
          const next = pendingPreferenceCommand;
          pendingPreferenceCommand = null;
          await workspaceService.execute(next);
        }
        processingPreferenceCommand = false;
      })();
    };
    const onFinish = (featureId: string | number) => {
      const feature = draw?.getSnapshotFeature(featureId);
      if (!feature || feature.geometry.type !== 'Polygon') return;
      const geometry = {
        type: 'Feature',
        properties: {},
        geometry: feature.geometry,
      } as AreaGeometry;
      drawnPreferenceIdRef.current = featureId;
      draw?.setMode('select');
      if (!completePreferenceDraw(geometry)) {
        queuePreferenceCommand({ type: 'add-preference', geometry });
      }
    };
    const onDrawChange = (featureIds: Array<string | number>, changeType: string) => {
      if (syncingDrawRef.current) return;
      const preferenceId = workspaceSnapshot().canonical.conditions.find(
        (condition) => condition.kind === 'preference',
      )?.id;
      if (changeType === 'delete' && drawnPreferenceIdRef.current !== null) {
        if (featureIds.includes(drawnPreferenceIdRef.current) && preferenceId) {
          drawnPreferenceIdRef.current = null;
          queuePreferenceCommand({ type: 'delete-condition', id: preferenceId });
        }
        return;
      }
      if (changeType !== 'update') return;
      const featureId = drawnPreferenceIdRef.current;
      if (featureId === null || !featureIds.includes(featureId)) return;
      const feature = draw?.getSnapshotFeature(featureId);
      if (feature?.geometry.type === 'Polygon') {
        queuePreferenceCommand({
          type: 'add-preference',
          geometry: {
            type: 'Feature',
            properties: {},
            geometry: feature.geometry,
          },
        });
      }
    };
    draw?.on('finish', onFinish);
    draw?.on('change', onDrawChange);
    useWorkspaceStore.getState().commit({ drawingReady: Boolean(draw?.enabled) });

    return () => {
      if (workspaceSnapshot().operation === 'drawing') {
        cancelPreferenceDraw('Drawing was cancelled because the map closed.');
      }
      draw?.off('finish', onFinish);
      draw?.off('change', onDrawChange);
      useWorkspaceStore.getState().commit({ drawingReady: false });
      window.removeEventListener('sweetspot:start-draw', onStartDraw);
      window.removeEventListener('sweetspot:cancel-draw', onCancelDraw);
      window.removeEventListener('keydown', onKeyDown);
      map.off('error', onMapError);
      map.off('moveend', onMoveEnd);
      for (const marker of destinationMarkers.values()) marker.remove();
      destinationMarkers.clear();
      map.remove();
      drawControlRef.current = null;
      mapRef.current = null;
    };
  }, [city, mapAttempt]);

  useEffect(() => {
    const draw = drawControlRef.current?.getTerraDrawInstance();
    if (!draw?.enabled) return;
    const preference = canonical.conditions.find((condition) => condition.kind === 'preference');
    syncingDrawRef.current = true;
    try {
      const existingId = drawnPreferenceIdRef.current;
      if (!preference || preference.geometry.geometry.type !== 'Polygon') {
        if (existingId !== null && draw.hasFeature(existingId)) draw.removeFeatures([existingId]);
        drawnPreferenceIdRef.current = null;
        return;
      }
      if (existingId !== null && draw.hasFeature(existingId)) {
        draw.updateFeatureGeometry(existingId, preference.geometry.geometry);
      } else {
        const featureId = draw.getFeatureId();
        const results = draw.addFeatures([
          {
            id: featureId,
            type: 'Feature',
            properties: { mode: 'polygon' },
            geometry: preference.geometry.geometry,
          },
        ]);
        if (results[0]?.valid) drawnPreferenceIdRef.current = featureId;
      }
    } finally {
      syncingDrawRef.current = false;
    }
  }, [canonical.conditions, drawReadyVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    syncWorkspaceSources(map, canonical, derived);
  }, [canonical, derived]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of destinationMarkersRef.current.values()) marker.remove();
    destinationMarkersRef.current.clear();
    const colors = ['#ff7657', '#aa8ff3', '#29d3d1', '#ffc857'];
    destinations.forEach((destination, index) => {
      const marker = new maplibregl.Marker({ color: colors[index], draggable: true })
        .setLngLat(destination.coordinates)
        .setPopup(new maplibregl.Popup({ offset: 24 }).setText(destination.label))
        .addTo(map);
      marker.on('dragend', async () => {
        const location = marker.getLngLat();
        const result = await workspaceService.execute({
          type: 'update-destination',
          actor: 'user',
          destination: {
            ...destination,
            coordinates: [location.lng, location.lat],
          },
        });
        if (!result.ok) {
          const currentDestination = workspaceSnapshot().canonical.destinations.find(
            ({ id }) => id === destination.id,
          );
          if (currentDestination) marker.setLngLat(currentDestination.coordinates);
        }
      });
      destinationMarkersRef.current.set(destination.id, marker);
    });
  }, [destinations]);

  return (
    <div className="map-shell">
      <div
        ref={containerRef}
        className="map-canvas"
        aria-label={`Interactive ${city.name} analysis map`}
      />
      {mapError ? (
        <div className="map-error" role="alert">
          <strong>Map unavailable</strong>
          <span>{mapError} Your conditions and results are still available in the panels.</span>
          <button type="button" onClick={() => setMapAttempt((attempt) => attempt + 1)}>
            Retry map
          </button>
        </div>
      ) : null}
    </div>
  );
}
