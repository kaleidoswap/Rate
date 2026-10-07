// components/map/PlacesMap.tsx
//
// A MapLibre GL map (OpenStreetMap data, OpenFreeMap dark vector tiles, no API
// key) in a WebView. Places are one GeoJSON circle layer, so hundreds of
// markers stay smooth. React Native drives it through `window.kmap`; taps and
// user pans come back via postMessage.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { theme } from '../../theme';
import type { Coords } from '../../utils/btcMapPlaces';

export interface MapMarker {
  id: number;
  lat: number;
  lon: number;
  color: string;
}

export interface PlacesMapHandle {
  flyTo: (c: Coords, zoom?: number) => void;
}

interface Props {
  initialCenter: Coords;
  markers: MapMarker[];
  selectedId: number | null;
  user: Coords | null;
  onSelect: (id: number | null) => void;
  /** The user panned or zoomed: the new centre and a radius covering the view. */
  onMoved: (center: Coords, radiusKm: number) => void;
  onError?: () => void;
  /** Space covered by UI overlapping the map's bottom edge (keeps attribution visible). */
  bottomInset?: number;
}

const MAPLIBRE = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0';
const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

const buildHtml = (c: Coords, colors: { bg: string; water: string; user: string; ring: string; cluster: string; clusterText: string; bottomInset: number }) => `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.min.css"
  integrity="sha384-GriUtmHM/C5kppqM+je9BCInk5YLY4k8/MEXQNSB9gE0BLi6af+iFZlypsIX+LE6" crossorigin="anonymous" />
<style>
  html, body, #map { height: 100%; margin: 0; background: ${colors.bg}; }
  .maplibregl-ctrl-attrib { background: rgba(10,19,38,0.75) !important; color: rgba(255,255,255,0.75) !important; font-size: 9px; }
  .maplibregl-ctrl-attrib-inner, .maplibregl-ctrl-attrib-inner * { color: rgba(255,255,255,0.75) !important; }
  .maplibregl-ctrl-attrib a { color: rgba(255,255,255,0.75) !important; }
  .maplibregl-ctrl-attrib-button { filter: invert(1); }
  .maplibregl-ctrl-bottom-left { bottom: ${colors.bottomInset}px; }
</style>
</head><body><div id="map"></div>
<script src="${MAPLIBRE}/maplibre-gl.min.js"
  integrity="sha384-/fkW0eF+JadmqTh/3DP/LoBDPsacir3SNbnZ8aD7sozuTkUVhgCNHPSBfJura3aL" crossorigin="anonymous"></script>
<script>
(function () {
  function post(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  if (!window.maplibregl) { post({ type: 'error' }); return; }
  var loaded = false;
  var failTimer = setTimeout(function () { if (!loaded) post({ type: 'error' }); }, 20000);
  var map = new maplibregl.Map({
    container: 'map', style: '${STYLE_URL}', center: [${c.lng}, ${c.lat}], zoom: 14,
    attributionControl: false, pitchWithRotate: false, dragRotate: false, fadeDuration: 0
  });
  map.touchZoomRotate.disableRotation();
  // Bottom-left, clear of the app's locate button (bottom-right) and the
  // filter chips floating over the top.
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  var empty = { type: 'FeatureCollection', features: [] };
  var pending = { places: null, selected: null, user: null };

  function placesGeo(list) {
    return { type: 'FeatureCollection', features: list.map(function (m) {
      return { type: 'Feature', properties: { id: m.id, color: m.color }, geometry: { type: 'Point', coordinates: [m.lon, m.lat] } };
    }) };
  }
  function setPlaces(list) {
    if (!loaded) { pending.places = list; return; }
    map.getSource('places').setData(placesGeo(list));
  }
  function select(id, lat, lng) {
    pending.selected = id;
    if (!loaded) return;
    map.setFilter('places-selected', ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], id == null ? -1 : id]]);
    if (id != null && lat != null) map.easeTo({ center: [lng, lat], duration: 400 });
  }
  function setUser(lat, lng) {
    pending.user = lat == null ? null : [lng, lat];
    if (!loaded) return;
    map.getSource('user').setData(lat == null ? empty : { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } });
  }
  function flyTo(lat, lng, zoom) {
    map.flyTo({ center: [lng, lat], zoom: zoom == null ? map.getZoom() : zoom, duration: 800 });
  }

  map.on('load', function () {
    loaded = true; clearTimeout(failTimer);
    try {
      map.setPaintProperty('background', 'background-color', '${colors.bg}');
      map.setPaintProperty('water', 'fill-color', '${colors.water}');
    } catch (e) {}
    // Nearby places are often on top of each other: group them until zoomed in.
    map.addSource('places', { type: 'geojson', data: empty, cluster: true, clusterRadius: 38, clusterMaxZoom: 16 });
    map.addSource('user', { type: 'geojson', data: empty });
    map.addLayer({ id: 'clusters', type: 'circle', source: 'places', filter: ['has', 'point_count'], paint: {
      'circle-color': '${colors.cluster}', 'circle-opacity': 0.9,
      'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 23],
      'circle-stroke-color': '${colors.ring}', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'], layout: {
      'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12,
      'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
      paint: { 'text-color': '${colors.clusterText}' } });
    map.addLayer({ id: 'places', type: 'circle', source: 'places', filter: ['!', ['has', 'point_count']], paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 13, 6, 17, 9],
      'circle-stroke-color': '${colors.ring}', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'places-selected', type: 'circle', source: 'places', filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], -1]], paint: {
      'circle-color': ['get', 'color'], 'circle-radius': 12,
      'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3 } });
    map.addLayer({ id: 'user-halo', type: 'circle', source: 'user', paint: {
      'circle-color': '${colors.user}', 'circle-opacity': 0.2, 'circle-radius': 20 } });
    map.addLayer({ id: 'user', type: 'circle', source: 'user', paint: {
      'circle-color': '${colors.user}', 'circle-radius': 7, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2.5 } });
    if (pending.places) setPlaces(pending.places);
    if (pending.user) setUser(pending.user[1], pending.user[0]);
    select(pending.selected);
    // Start with the attribution folded to its (i) button.
    var attrib = document.querySelector('.maplibregl-ctrl-attrib');
    if (attrib) attrib.classList.remove('maplibregl-compact-show');
    post({ type: 'ready' });
  });
  map.on('error', function (e) { if (!loaded) { clearTimeout(failTimer); post({ type: 'error' }); } });

  map.on('click', function (e) {
    var box = [[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]];
    var groups = loaded ? map.queryRenderedFeatures(box, { layers: ['clusters'] }) : [];
    if (groups.length) {
      var g = groups[0];
      Promise.resolve(map.getSource('places').getClusterExpansionZoom(g.properties.cluster_id)).then(function (z) {
        map.easeTo({ center: g.geometry.coordinates, zoom: z + 0.5, duration: 400 });
      }).catch(function () {});
      return;
    }
    var hits = loaded ? map.queryRenderedFeatures(box, { layers: ['places-selected', 'places'] }) : [];
    post({ type: 'select', id: hits.length ? hits[0].properties.id : null });
  });
  map.on('moveend', function (e) {
    if (!e.originalEvent) return;
    var c = map.getCenter(), b = map.getBounds();
    post({ type: 'moved', lat: c.lat, lng: c.lng, radiusKm: c.distanceTo(b.getNorthEast()) / 1000 });
  });
  window.kmap = { setPlaces: setPlaces, select: select, setUser: setUser, flyTo: flyTo };
  post({ type: 'boot' });
})();
</script></body></html>`;

export const PlacesMap = forwardRef<PlacesMapHandle, Props>(function PlacesMap(
  { initialCenter, markers, selectedId, user, onSelect, onMoved, onError, bottomInset = 0 },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  // Built once: later centre changes go through flyTo, not a reload.
  const [html] = useState(() =>
    buildHtml(initialCenter, {
      bg: theme.colors.background.primary,
      water: theme.colors.gray[50],
      bottomInset: bottomInset,
      user: theme.colors.info[500],
      ring: theme.colors.background.primary,
      cluster: theme.colors.primary[500],
      clusterText: theme.colors.text.inverse,
    }),
  );

  const run = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`try{${js}}catch(e){};true;`);
  }, []);

  const readyRef = useRef(false);
  // A flyTo asked for before the map is ready is applied once it is.
  const pendingFly = useRef<string | null>(null);
  useImperativeHandle(ref, () => ({
    flyTo: (c, zoom) => {
      const js = `kmap.flyTo(${c.lat},${c.lng},${zoom ?? 'null'})`;
      if (readyRef.current) run(js);
      else pendingFly.current = js;
    },
  }), [run]);
  useEffect(() => {
    readyRef.current = ready;
    if (ready && pendingFly.current) {
      run(pendingFly.current);
      pendingFly.current = null;
    }
  }, [ready, run]);

  const markersJson = useMemo(() => JSON.stringify(markers), [markers]);
  useEffect(() => {
    if (ready) run(`kmap.setPlaces(${markersJson})`);
  }, [ready, markersJson, run]);

  const markersRef = useRef(markers);
  markersRef.current = markers;
  useEffect(() => {
    if (!ready) return;
    const m = selectedId == null ? undefined : markersRef.current.find((x) => x.id === selectedId);
    run(m ? `kmap.select(${m.id},${m.lat},${m.lon})` : `kmap.select(${selectedId ?? 'null'})`);
  }, [ready, selectedId, run]);

  useEffect(() => {
    if (ready) run(user ? `kmap.setUser(${user.lat},${user.lng})` : 'kmap.setUser(null)');
  }, [ready, user, run]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg?.type === 'ready') setReady(true);
    else if (msg?.type === 'error') onError?.();
    else if (msg?.type === 'select') onSelect(typeof msg.id === 'number' ? msg.id : null);
    else if (msg?.type === 'moved' && Number.isFinite(msg.lat) && Number.isFinite(msg.lng)) {
      onMoved({ lat: msg.lat, lng: msg.lng }, Number(msg.radiusKm) || 2);
    }
  }, [onError, onMoved, onSelect]);

  return (
    <View style={styles.fill}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost/' }}
        style={styles.fill}
        onMessage={onMessage}
        onLoadStart={() => setReady(false)}
        onError={() => onError?.()}
        onContentProcessDidTerminate={() => webRef.current?.reload()}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background.primary },
});
