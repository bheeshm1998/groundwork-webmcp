import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { MaplibreTerradrawControl } from '@watergis/maplibre-gl-terradraw';
import '@watergis/maplibre-gl-terradraw/dist/maplibre-gl-terradraw.css';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { AreaGeometry } from '../domain/schemas';
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
          kind: condition.kind === 'access' ? condition.category : condition.kind,
        },
      });
    }
  }
  setSourceData(map, 'groundwork-conditions', { type: 'FeatureCollection', features });
  setSourceData(map, 'groundwork-feasible', derived.feasibleRegion ?? EMPTY_COLLECTION);
  const candidateFeatures: Array<Feature<Point>> = derived.candidates.map((candidate, index) => ({
    type: 'Feature',
    properties: {
      candidateId: candidate.id,
      rank: String(index + 1),
      selected: canonical.selectedCandidateId === candidate.id,
    },
    geometry: { type: 'Point', coordinates: candidate.coordinates },
  }));
  setSourceData(map, 'groundwork-candidates', {
    type: 'FeatureCollection',
    features: candidateFeatures,
  });
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const officeMarkerRef = useRef<Marker | null>(null);
  const drawControlRef = useRef<MaplibreTerradrawControl | null>(null);
  const drawnPreferenceIdRef = useRef<string | number | null>(null);
  const syncingDrawRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [drawReadyVersion, setDrawReadyVersion] = useState(0);
  const canonical = useWorkspaceStore((state) => state.canonical);
  const office = useWorkspaceStore((state) => state.canonical.office);
  const derived = useWorkspaceStore((state) => state.derived);
  const cityId = useWorkspaceStore((state) => state.cityId);
  const city = CITIES[cityId];
  const initialViewRef = useRef(canonical.view);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
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
      map.addSource('groundwork-conditions', { type: 'geojson', data: EMPTY_COLLECTION });
      map.addLayer({
        id: 'groundwork-condition-fill',
        type: 'fill',
        source: 'groundwork-conditions',
        paint: {
          'fill-color': [
            'match',
            ['get', 'kind'],
            'bike',
            '#29d3d1',
            'grocery',
            '#f0a43c',
            'park',
            '#5cc47b',
            '#aa8ff3',
          ],
          'fill-opacity': 0.22,
        },
      });
      map.addLayer({
        id: 'groundwork-condition-line',
        type: 'line',
        source: 'groundwork-conditions',
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'bike',
            '#29d3d1',
            'grocery',
            '#f0a43c',
            'park',
            '#5cc47b',
            '#aa8ff3',
          ],
          'line-width': 2,
        },
      });
      map.addSource('groundwork-feasible', { type: 'geojson', data: EMPTY_COLLECTION });
      map.addLayer({
        id: 'groundwork-feasible-fill',
        type: 'fill',
        source: 'groundwork-feasible',
        paint: { 'fill-color': '#d9ff5a', 'fill-opacity': 0.42 },
      });
      map.addLayer({
        id: 'groundwork-feasible-line',
        type: 'line',
        source: 'groundwork-feasible',
        paint: { 'line-color': '#efffa8', 'line-width': 3, 'line-dasharray': [2, 1] },
      });
      map.addSource('groundwork-candidates', { type: 'geojson', data: EMPTY_COLLECTION });
      map.addLayer({
        id: 'groundwork-candidate-points',
        type: 'circle',
        source: 'groundwork-candidates',
        paint: {
          'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 13, 10],
          'circle-color': ['case', ['boolean', ['get', 'selected'], false], '#d9ff5a', '#102d2b'],
          'circle-stroke-color': '#f5ffe1',
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: 'groundwork-candidate-labels',
        type: 'symbol',
        source: 'groundwork-candidates',
        layout: { 'text-field': ['get', 'rank'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] },
        paint: {
          'text-color': ['case', ['boolean', ['get', 'selected'], false], '#102d2b', '#f5ffe1'],
        },
      });
      map.on('click', 'groundwork-candidate-points', (event: MapLayerMouseEvent) => {
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
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && workspaceSnapshot().operation === 'drawing') {
        cancelPreferenceDraw();
      }
    };
    window.addEventListener('groundwork:start-draw', onStartDraw);
    window.addEventListener('groundwork:cancel-draw', onCancelDraw);
    window.addEventListener('keydown', onKeyDown);

    const draw = drawControl.getTerraDrawInstance();
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
      completePreferenceDraw(geometry);
      void workspaceService.execute({ type: 'add-preference', geometry });
    };
    const onDrawChange = (featureIds: Array<string | number>, changeType: string) => {
      if (syncingDrawRef.current) return;
      const preferenceId = workspaceSnapshot().canonical.conditions.find(
        (condition) => condition.kind === 'preference',
      )?.id;
      if (changeType === 'delete' && drawnPreferenceIdRef.current !== null) {
        if (featureIds.includes(drawnPreferenceIdRef.current) && preferenceId) {
          drawnPreferenceIdRef.current = null;
          void workspaceService.execute({ type: 'delete-condition', id: preferenceId });
        }
        return;
      }
      if (changeType !== 'update') return;
      const featureId = drawnPreferenceIdRef.current;
      if (featureId === null || !featureIds.includes(featureId)) return;
      const feature = draw?.getSnapshotFeature(featureId);
      if (feature?.geometry.type === 'Polygon') {
        void workspaceService.execute({
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

    return () => {
      if (workspaceSnapshot().operation === 'drawing') {
        cancelPreferenceDraw('Drawing was cancelled because the map closed.');
      }
      draw?.off('finish', onFinish);
      draw?.off('change', onDrawChange);
      window.removeEventListener('groundwork:start-draw', onStartDraw);
      window.removeEventListener('groundwork:cancel-draw', onCancelDraw);
      window.removeEventListener('keydown', onKeyDown);
      map.off('error', onMapError);
      map.off('moveend', onMoveEnd);
      officeMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [city, mapAttempt]);

  useEffect(() => {
    const draw = drawControlRef.current?.getTerraDrawInstance();
    if (!draw) return;
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
    officeMarkerRef.current?.remove();
    officeMarkerRef.current = null;
    if (!office) return;
    const marker = new maplibregl.Marker({ color: '#ff7657', draggable: true })
      .setLngLat(office.coordinates)
      .setPopup(new maplibregl.Popup({ offset: 24 }).setText(office.label))
      .addTo(map);
    marker.on('dragend', () => {
      const location = marker.getLngLat();
      void workspaceService.execute({
        type: 'set-office',
        office: { label: 'Moved office marker', coordinates: [location.lng, location.lat] },
      });
    });
    officeMarkerRef.current = marker;
  }, [office]);

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
