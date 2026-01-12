console.log("✅ app.js running (v92)");

// ---------------- Map ----------------
const initialView = { center: [23.7, 121.0], zoom: 7 };
const map = L.map('map', { zoomControl: false }).setView(initialView.center, initialView.zoom);

// ---------------- Basemaps ----------------
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const satellite = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: 'Tiles © Esri' }
);

// ✅ Place names overlay
const esriLabels = L.tileLayer(
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: '© Esri (labels)' }
);

const baseMaps = {
  "OpenStreetMap": osm,
  "Satellite (Esri)": satellite
};

// ---------------- Layer control (TOP-RIGHT) ----------------
const layerControl = L.control.layers(baseMaps, {}, { collapsed: false, position: 'topright' }).addTo(map);
L.control.scale().addTo(map);

layerControl.addOverlay(esriLabels, "Place Names (Esri)");
esriLabels.addTo(map); // ON by default

// ---------------- Watershed styles ----------------
let watershedLayer = null;
let selectedLayer = null;

const watershedStyle = { color: 'red', weight: 3, fillColor: 'orange', fillOpacity: 0.5 };
const highlightStyle = { color: 'blue', weight: 4, fillColor: 'cyan', fillOpacity: 0.6 };

// ---------------- Draw ----------------
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

function fmt(n) { return (Math.round(n * 100) / 100).toLocaleString(); }

map.on(L.Draw.Event.CREATED, function (e) {
  const layer = e.layer;
  drawnItems.addLayer(layer);

  let msg = "<b>Measurement</b><br>";

  if (e.layerType === "polyline") {
    const latlngs = layer.getLatLngs();
    let meters = 0;
    for (let i = 1; i < latlngs.length; i++) meters += map.distance(latlngs[i - 1], latlngs[i]);
    msg += `Length: <b>${fmt(meters)}</b> m<br>`;
    msg += `Length: <b>${fmt(meters / 1000)}</b> km`;
  }

  if (e.layerType === "polygon") {
    const latlngs = layer.getLatLngs()[0];
    let perimeter = 0;
    for (let i = 1; i < latlngs.length; i++) perimeter += map.distance(latlngs[i - 1], latlngs[i]);
    perimeter += map.distance(latlngs[latlngs.length - 1], latlngs[0]);

    let area = null;
    if (L.GeometryUtil && L.GeometryUtil.geodesicArea) area = L.GeometryUtil.geodesicArea(latlngs);

    msg += `Perimeter: <b>${fmt(perimeter)}</b> m<br>`;
    if (area !== null) {
      msg += `Area: <b>${fmt(area)}</b> m²<br>`;
      msg += `Area: <b>${fmt(area / 10000)}</b> ha`;
    }
  }

  layer.bindPopup(msg).openPopup();
});

// ---------------- ✅ Geolocation ----------------
let myLocationMarker = null;
let myLocationCircle = null;

function removeMyLocation() {
  if (myLocationMarker) {
    map.removeLayer(myLocationMarker);
    myLocationMarker = null;
  }
  if (myLocationCircle) {
    map.removeLayer(myLocationCircle);
    myLocationCircle = null;
  }
}

function locateMe() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy;

      removeMyLocation();

      myLocationMarker = L.marker([lat, lon]).addTo(map);
      myLocationMarker.bindPopup(
        `<b>My Location</b><br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}<br>Accuracy: ~${Math.round(acc)} m`
      );

      myLocationCircle = L.circle([lat, lon], {
        radius: acc,
        weight: 2,
        fillOpacity: 0.15
      }).addTo(map);

      try {
        map.fitBounds(myLocationCircle.getBounds(), { padding: [30, 30] });
      } catch (e) {
        map.setView([lat, lon], 15);
      }

      myLocationMarker.openPopup();
    },
    (err) => {
      alert(`Cannot get location.\n\nReason: ${err.message}`);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

// ---------------- ✅ Export drawn data ----------------
function downloadTextFile(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportDrawnToGeoJSON() {
  const layers = drawnItems.getLayers();
  if (!layers.length) {
    alert("No drawn shapes to export. Draw something first (line/polygon/marker).");
    return;
  }

  const fc = drawnItems.toGeoJSON();

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `drawn_${ts}.geojson`;

  downloadTextFile(filename, JSON.stringify(fc, null, 2), "application/geo+json");
}

// ---------------- Upload GeoJSON (red boundary + click highlight) ----------------
let uploadedLayer = null;
let uploadedLayerName = "Uploaded GeoJSON";
let uploadedSelectedFeature = null;

const uploadedStyle = {
  color: 'red',
  weight: 3,
  fillColor: 'transparent',
  fillOpacity: 0.15
};

const uploadedHighlightStyle = {
  color: '#0066ff',
  weight: 4,
  fillColor: '#00ffff',
  fillOpacity: 0.45
};

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.geojson,.json,application/geo+json,application/json';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

function clearUploadedSelection() {
  if (uploadedSelectedFeature) {
    try { uploadedSelectedFeature.setStyle(uploadedStyle); } catch (e) {}
    uploadedSelectedFeature = null;
  }
}

function removeUploadedLayer() {
  if (!uploadedLayer) return;

  clearUploadedSelection();
  map.removeLayer(uploadedLayer);
  try { layerControl.removeLayer(uploadedLayer); } catch (e) {}

  uploadedLayer = null;
  console.log("🧹 Uploaded layer removed");
}

function addUploadedGeoJSON(geojsonObj, nameForControl) {
  removeUploadedLayer();

  uploadedLayer = L.geoJSON(geojsonObj, {
    style: uploadedStyle,
    onEachFeature: (feature, layer) => {
      const props = feature.properties || {};
      const html = Object.keys(props).length
        ? Object.entries(props).map(([k, v]) => `<b>${k}</b>: ${v}`).join('<br>')
        : "<b>Uploaded feature</b>";
      layer.bindPopup(html);

      layer.on('click', () => {
        clearUploadedSelection();
        layer.setStyle(uploadedHighlightStyle);
        uploadedSelectedFeature = layer;

        try { layer.bringToFront(); } catch (e) {}
        layer.openPopup();
      });
    }
  }).addTo(map);

  uploadedLayerName = nameForControl || "Uploaded GeoJSON";
  layerControl.addOverlay(uploadedLayer, uploadedLayerName);

  try {
    const b = uploadedLayer.getBounds();
    if (b && b.isValid()) map.fitBounds(b, { padding: [20, 20] });
  } catch (e) {}

  console.log("✅ Uploaded layer added:", uploadedLayerName);
}

fileInput.addEventListener('change', (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (!obj || !obj.type) {
        alert("This file is not valid GeoJSON.");
        return;
      }
      addUploadedGeoJSON(obj, `Uploaded: ${file.name}`);
    } catch (err) {
      console.error("❌ Upload parse error:", err);
      alert("Failed to read GeoJSON. Make sure it is valid JSON/GeoJSON.");
    } finally {
      fileInput.value = '';
    }
  };
  reader.readAsText(file);
});

// ---------------- Go-to XY (BOTTOM-RIGHT, Decimal + DMS) ----------------
let gotoMarker = null;
function removeGotoMarker() {
  if (gotoMarker) {
    map.removeLayer(gotoMarker);
    gotoMarker = null;
  }
}

function validateLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  return true;
}

function parseCoordSmart(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // decimal with optional hemisphere (23.7N)
  const dec = raw.match(/^([+-]?\d+(?:\.\d+)?)(?:\s*([NSEW]))?$/i);
  if (dec) {
    let val = parseFloat(dec[1]);
    const hemi = (dec[2] || '').toUpperCase();
    if (hemi === 'S' || hemi === 'W') val = -Math.abs(val);
    if (hemi === 'N' || hemi === 'E') val = Math.abs(val);
    return Number.isFinite(val) ? val : null;
  }

  // DMS cleanup
  const s = raw
    .replace(/,/g, ' ')
    .replace(/[°º]/g, ' ')
    .replace(/[′’']/g, ' ')
    .replace(/[″”"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const hemiMatch = s.match(/\b([NSEW])\b/i) || s.match(/([NSEW])$/i);
  const hemi = (hemiMatch ? hemiMatch[1] : '').toUpperCase();

  const nums = s.replace(/[NSEW]/ig, '').trim().split(' ').filter(Boolean);
  if (nums.length < 1) return null;

  const deg = parseFloat(nums[0]);
  const min = nums.length >= 2 ? parseFloat(nums[1]) : 0;
  const sec = nums.length >= 3 ? parseFloat(nums[2]) : 0;
  if (![deg, min, sec].every(n => Number.isFinite(n))) return null;

  let val = Math.abs(deg) + (Math.abs(min) / 60) + (Math.abs(sec) / 3600);
  if (deg < 0) val = -val;

  if (hemi === 'S' || hemi === 'W') val = -Math.abs(val);
  if (hemi === 'N' || hemi === 'E') val = Math.abs(val);

  return val;
}

function parseLatLonSmart(text) {
  if (!text) return null;
  const raw = String(text).trim();

  // comma split
  if (raw.includes(',')) {
    const parts = raw.split(',');
    if (parts.length < 2) return null;
    const lat = parseCoordSmart(parts[0]);
    const lon = parseCoordSmart(parts[1]);
    if (!validateLatLon(lat, lon)) return null;
    return { lat, lon };
  }

  // no comma: try split positions
  const tokens = raw.replace(/\s+/g, ' ').trim().split(' ');
  if (tokens.length < 2) return null;

  for (let i = 1; i < tokens.length; i++) {
    const a = tokens.slice(0, i).join(' ');
    const b = tokens.slice(i).join(' ');
    const lat = parseCoordSmart(a);
    const lon = parseCoordSmart(b);
    if (validateLatLon(lat, lon)) return { lat, lon };
  }
  return null;
}

function gotoLatLon(lat, lon, zoom = 15) {
  removeGotoMarker();
  gotoMarker = L.marker([lat, lon]).addTo(map);
  gotoMarker.bindPopup(`<b>Go-to Location</b><br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}`).openPopup();
  map.setView([lat, lon], zoom);
}

const GoToXYControl = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd: function () {
    const div = L.DomUtil.create('div', 'leaflet-control');
    div.style.background = 'rgba(255,255,255,0.92)';
    div.style.border = '1px solid rgba(0,0,0,0.25)';
    div.style.borderRadius = '8px';
    div.style.padding = '8px';
    div.style.fontFamily = 'Arial, sans-serif';
    div.style.fontSize = '12px';
    div.style.display = 'flex';
    div.style.flexDirection = 'column';
    div.style.gap = '6px';
    div.style.minWidth = '260px';

    const title = document.createElement('div');
    title.textContent = "Go-to XY (Decimal or DMS)";
    title.style.fontWeight = '800';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '23.7, 121.0  OR  23 30 0 N, 121 0 0 E';
    input.style.width = '100%';
    input.style.height = '30px';
    input.style.border = '1px solid rgba(0,0,0,0.25)';
    input.style.borderRadius = '6px';
    input.style.padding = '0 8px';
    input.style.boxSizing = 'border-box';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';

    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.textContent = "Go";
    goBtn.style.flex = '1';
    goBtn.style.height = '30px';
    goBtn.style.border = '1px solid rgba(0,0,0,0.25)';
    goBtn.style.borderRadius = '6px';
    goBtn.style.background = '#fff';
    goBtn.style.cursor = 'pointer';
    goBtn.style.fontWeight = '800';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = "Clear";
    clearBtn.style.width = '70px';
    clearBtn.style.height = '30px';
    clearBtn.style.border = '1px solid rgba(0,0,0,0.25)';
    clearBtn.style.borderRadius = '6px';
    clearBtn.style.background = '#fff';
    clearBtn.style.cursor = 'pointer';
    clearBtn.style.fontWeight = '800';

    row.appendChild(goBtn);
    row.appendChild(clearBtn);

    const hint = document.createElement('div');
    hint.style.fontSize = '11px';
    hint.style.opacity = '0.85';
    hint.innerHTML = `Examples: <b>23.7,121.0</b> · <b>23.7N 121.0E</b> · <b>23 30 0 N, 121 0 0 E</b>`;

    function doGo() {
      const parsed = parseLatLonSmart(input.value);
      if (!parsed) {
        alert("Invalid coordinates.\n\nUse Decimal: 23.7, 121.0\nOr DMS: 23 30 0 N, 121 0 0 E");
        return;
      }
      gotoLatLon(parsed.lat, parsed.lon, 15);
    }

    goBtn.addEventListener('click', doGo);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doGo(); });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      removeGotoMarker();
    });

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    div.appendChild(title);
    div.appendChild(input);
    div.appendChild(row);
    div.appendChild(hint);

    // ✅ keep top-right control from visually conflicting with the bottom-right panel
    setTimeout(() => {
      const topRight = document.querySelector('.leaflet-top.leaflet-right');
      if (topRight) topRight.style.paddingBottom = '120px';
    }, 0);

    return div;
  }
});
map.addControl(new GoToXYControl());

// ---------------- Unified LEFT Toolbar ----------------
const LeftToolbar = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function () {
    const container = L.DomUtil.create('div', 'leaflet-control custom-right-toolbar');
    const stack = L.DomUtil.create('div', 'tool-stack', container);

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const makeBlock = () => L.DomUtil.create('div', 'tool-block', stack);

    // Zoom
    const zoomBlock = makeBlock();
    const zoomCtrl = L.control.zoom({ position: 'topleft' });
    zoomCtrl.addTo(map);
    zoomBlock.appendChild(zoomCtrl.getContainer());

    // Search
    const searchBlock = makeBlock();
    const geocoderCtrl = L.Control.geocoder({ position: 'topleft', defaultMarkGeocode: true });
    geocoderCtrl.addTo(map);
    searchBlock.appendChild(geocoderCtrl.getContainer());

    // Print
    const printBlock = makeBlock();
    if (typeof L.control.browserPrint === "function") {
      const printCtrl = L.control.browserPrint({ position: 'topleft', title: 'Print map' });
      printCtrl.addTo(map);
      printBlock.appendChild(printCtrl.getContainer());
    }

    // Draw
    const drawBlock = makeBlock();
    const drawCtrl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: { allowIntersection: false, showArea: true },
        polyline: true,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: true
      },
      edit: { featureGroup: drawnItems, edit: true, remove: true }
    });
    drawCtrl.addTo(map);
    drawBlock.appendChild(drawCtrl.getContainer());

    // Upload
    const uploadBlock = makeBlock();
    const uploadBtn = L.DomUtil.create('button', 'tool-btn', uploadBlock);
    uploadBtn.type = 'button';
    uploadBtn.title = 'Upload GeoJSON';
    uploadBtn.innerHTML = '<span class="sym">⬆</span>';
    L.DomEvent.on(uploadBtn, 'click', () => fileInput.click());

    // Remove uploaded
    const removeUpBlock = makeBlock();
    const removeUpBtn = L.DomUtil.create('button', 'tool-btn', removeUpBlock);
    removeUpBtn.type = 'button';
    removeUpBtn.title = 'Remove uploaded layer';
    removeUpBtn.innerHTML = '<span class="sym">🗑</span>';
    L.DomEvent.on(removeUpBtn, 'click', () => {
      removeUploadedLayer();
      map.closePopup();
    });

    // My Location
    const locBlock = makeBlock();
    const locBtn = L.DomUtil.create('button', 'tool-btn', locBlock);
    locBtn.type = 'button';
    locBtn.title = 'My Location';
    locBtn.innerHTML = '<span class="sym">📍</span>';
    L.DomEvent.on(locBtn, 'click', () => locateMe());

    // Export drawings
    const expBlock = makeBlock();
    const expBtn = L.DomUtil.create('button', 'tool-btn', expBlock);
    expBtn.type = 'button';
    expBtn.title = 'Export drawn shapes (GeoJSON)';
    expBtn.innerHTML = '<span class="sym">💾</span>';
    L.DomEvent.on(expBtn, 'click', () => exportDrawnToGeoJSON());

    // Home
    const homeBlock = makeBlock();
    const homeBtn = L.DomUtil.create('button', 'tool-btn', homeBlock);
    homeBtn.type = 'button';
    homeBtn.title = 'Home';
    homeBtn.innerHTML = '<span class="sym">⌂</span>';
    L.DomEvent.on(homeBtn, 'click', () => {
      if (watershedLayer) map.fitBounds(watershedLayer.getBounds(), { padding: [20, 20] });
      else map.setView(initialView.center, initialView.zoom);
    });

    // Clear
    const clearBlock = makeBlock();
    const clearBtn = L.DomUtil.create('button', 'tool-btn', clearBlock);
    clearBtn.type = 'button';
    clearBtn.title = 'Clear selection / drawings';
    clearBtn.innerHTML = '<span class="sym">✖</span>';
    L.DomEvent.on(clearBtn, 'click', () => {
      if (selectedLayer) {
        selectedLayer.setStyle(watershedStyle);
        selectedLayer = null;
      }
      clearUploadedSelection();
      removeMyLocation();
      removeGotoMarker();
      map.closePopup();
      drawnItems.clearLayers();
    });

    // Fullscreen
    const fsBlock = makeBlock();
    const fsBtn = L.DomUtil.create('button', 'tool-btn', fsBlock);
    fsBtn.type = 'button';
    fsBtn.title = 'Fullscreen';
    fsBtn.innerHTML = '<span class="sym">⛶</span>';

    const mapEl = map.getContainer();
    function toggleFullscreen() {
      if (!document.fullscreenElement) mapEl.requestFullscreen?.();
      else document.exitFullscreen?.();
      setTimeout(() => map.invalidateSize(), 200);
    }
    L.DomEvent.on(fsBtn, 'click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => setTimeout(() => map.invalidateSize(), 200));

    return container;
  }
});
map.addControl(new LeftToolbar());

// ---------------- Load watershed GeoJSON ----------------
const watershedPath = 'Data/watershed.geoJSON/watershed.geojson';

fetch(watershedPath)
  .then(r => { if (!r.ok) throw new Error(`GeoJSON not found (HTTP ${r.status})`); return r.json(); })
  .then(data => {
    watershedLayer = L.geoJSON(data, {
      style: watershedStyle,
      onEachFeature: (feature, layer) => {
        layer.on('click', () => {
          if (selectedLayer) selectedLayer.setStyle(watershedStyle);
          layer.setStyle(highlightStyle);
          selectedLayer = layer;

          const props = feature.properties || {};
          const content = Object.entries(props)
            .map(([k, v]) => `<b>${k}</b>: ${v}`)
            .join('<br>') || "<b>Watershed</b>";

          layer.bindPopup(content).openPopup();
        });
      }
    }).addTo(map);

    map.fitBounds(watershedLayer.getBounds(), { padding: [20, 20] });
    layerControl.addOverlay(watershedLayer, "Putunpunas Watershed");
  })
  .catch(err => console.error("❌ GeoJSON error:", err));

// ---------------- Live Mouse Coordinates (bottom center) ----------------
const MouseCoordsControl = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd: function () {
    const div = L.DomUtil.create('div', 'mouse-coords-control');
    div.innerHTML = 'Lat: -- , Lon: --';
    return div;
  }
});
map.addControl(new MouseCoordsControl());

map.on('mousemove', function (e) {
  const lat = e.latlng.lat.toFixed(6);
  const lon = e.latlng.lng.toFixed(6);
  const el = document.querySelector('.mouse-coords-control');
  if (el) el.innerHTML = `Lat: <b>${lat}</b> , Lon: <b>${lon}</b>`;
});

map.on('mouseout', function () {
  const el = document.querySelector('.mouse-coords-control');
  if (el) el.innerHTML = 'Lat: -- , Lon: --';
});
