/* ============================================================
   Pond Sampling WebGIS — application logic
   ------------------------------------------------------------
   Markers carry TWO pieces of information at once:
     • COLOUR  = pH classification (acidic / normal / alkaline)
     • SHAPE   = sample type
         pond=circle, lake=square, river=triangle,
         reservoir=hexagon, anything else=diamond

   Auto-refreshes every 10 s so new Google Sheet rows appear.
   ============================================================ */

/* ------------------------------------------------------------
   1. CONFIGURATION  —  EDIT THESE VALUES
   ------------------------------------------------------------ */

// Your published Google Sheet CSV link.
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQYDiXd_9fMUQqXxx8GwDhCCWVSy-aER20gaEP7stv5l30g62MOkzs1VRaiXlVx6jkMdV6fCOg4I0_3/pub?gid=0&single=true&output=csv";

// How often to re-fetch the sheet, in milliseconds (10000 = 10 seconds).
const REFRESH_MS = 10000;

// Initial map centre [lat, lng] and zoom — roughly the Bhaktapur ponds cluster.
const MAP_CENTER = [27.6745, 85.4285];
const MAP_ZOOM = 14;

/* ------------------------------------------------------------
   2. BUILT-IN SAMPLE DATA (fallback)
   ------------------------------------------------------------
   Used only if the live fetch fails, so the map is never blank.
   Mixed Sample Types below demo every marker shape.
   ------------------------------------------------------------ */
const SAMPLE_DATA = [
  { "Ponds_data_collection": "Rani Pokhari",   "Sample Type": "Pond",      "Latitude": 27.6721, "Longitude": 85.4151, "Time": "3:10 PM", "RH (%)": 70.1, "Avg Wind Speed": 0.7, "Lux": 1.1, "Air Temp (°C)": 26.5, "pH": 7.67, "DO (mg/L)": 7.23,  "EC (µS/cm)": 211, "Turbidity (NTU)": 101,  "Water Temp (°C)": 26.64 },
  { "Ponds_data_collection": "Sidhha Pokhari", "Sample Type": "Lake",      "Latitude": 27.6717, "Longitude": 85.4201, "Time": "3:40 PM", "RH (%)": 63.5, "Avg Wind Speed": 0.8, "Lux": 1.4, "Air Temp (°C)": 26.6, "pH": 10.92,"DO (mg/L)": 16.45, "EC (µS/cm)": 131, "Turbidity (NTU)": 513,  "Water Temp (°C)": 27.93 },
  { "Ponds_data_collection": "Bhajya Pokhari", "Sample Type": "Pond",      "Latitude": 27.6707, "Longitude": 85.4211, "Time": "4:15 PM", "RH (%)": 63.3, "Avg Wind Speed": 0.7, "Lux": 1.0, "Air Temp (°C)": 27.5, "pH": 8.59, "DO (mg/L)": 9.9,   "EC (µS/cm)": 192, "Turbidity (NTU)": 57.8, "Water Temp (°C)": 27.05 },
  { "Ponds_data_collection": "Na Pokhari",     "Sample Type": "River",     "Latitude": 27.6761, "Longitude": 85.4372, "Time": "4:50 PM", "RH (%)": 63.3, "Avg Wind Speed": 0.7, "Lux": 3.5, "Air Temp (°C)": 27.4, "pH": 10.41,"DO (mg/L)": 15.24, "EC (µS/cm)": 154, "Turbidity (NTU)": 485,  "Water Temp (°C)": 26.18 },
  { "Ponds_data_collection": "Lamgal Pokhari", "Sample Type": "Reservoir", "Latitude": 27.6754, "Longitude": 85.4365, "Time": "5:50 PM", "RH (%)": 63.2, "Avg Wind Speed": 0.4, "Lux": 3.7, "Air Temp (°C)": 27.5, "pH": 6.41, "DO (mg/L)": 2.92,  "EC (µS/cm)": 316, "Turbidity (NTU)": 45.8, "Water Temp (°C)": 22.04 },
  { "Ponds_data_collection": "Kamal Pokhari",  "Sample Type": "Lake",      "Latitude": 27.6768, "Longitude": 85.4384, "Time": "6:15 PM", "RH (%)": 65.4, "Avg Wind Speed": 0.4, "Lux": 0.5, "Air Temp (°C)": 22.4, "pH": 9.96, "DO (mg/L)": 12.9,  "EC (µS/cm)": 147, "Turbidity (NTU)": 285,  "Water Temp (°C)": 25.78 }
];

/* ------------------------------------------------------------
   3. MAP SETUP
   ------------------------------------------------------------ */
const map = L.map("map", { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
let hasFitBounds = false;

/* ------------------------------------------------------------
   4. HELPERS
   ------------------------------------------------------------ */

// Classify a pH value -> a key, label, and CSS colour variable.
function classifyPh(ph) {
  if (ph === null || isNaN(ph)) return { key: "unknown", label: "No pH", color: "#9aa6a2" };
  if (ph < 6.5)  return { key: "acid",     label: "Acidic",   color: cssVar("--c-acid") };
  if (ph <= 8.5) return { key: "normal",   label: "Normal",   color: cssVar("--c-normal") };
  return            { key: "alkaline", label: "Alkaline", color: cssVar("--c-alkaline") };
}

// Map a sample type -> a marker shape.
// Add more "if" lines here if you introduce new types later.
function shapeForType(type) {
  const t = String(type).toLowerCase();
  if (t.includes("lake"))      return "square";
  if (t.includes("river"))     return "triangle";
  if (t.includes("reservoir")) return "hexagon";
  if (t.includes("pond"))      return "circle";
  return "diamond"; // fallback for blank / unknown types
}

// Read a CSS custom property value (so JS and CSS share one palette).
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Build a Leaflet divIcon: an SVG of the chosen shape, filled with the pH colour.
// SVG keeps shapes crisp at any zoom and lets us recolour per pH.
function makeMarkerIcon(shape, color) {
  let inner;
  switch (shape) {
    case "square":
      inner = `<rect x="3" y="3" width="16" height="16" rx="2" fill="${color}" stroke="#fff" stroke-width="2"/>`;
      break;
    case "triangle":
      inner = `<polygon points="11,2.5 20,19 2,19" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
      break;
    case "hexagon":
      inner = `<polygon points="11,2 18.8,6.5 18.8,15.5 11,20 3.2,15.5 3.2,6.5" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
      break;
    case "diamond":
      inner = `<polygon points="11,2 20,11 11,20 2,11" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
      break;
    case "circle":
    default:
      inner = `<circle cx="11" cy="11" r="8" fill="${color}" stroke="#fff" stroke-width="2"/>`;
      break;
  }

  const svg =
    `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"
          style="filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.45))">${inner}</svg>`;

  // Custom className stops Leaflet drawing its default white box around divIcons.
  // iconAnchor centres the shape exactly on the coordinate.
  return L.divIcon({
    html: svg,
    className: "pond-marker",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
    tooltipAnchor: [0, -10]
  });
}

// Find a row's value by trying several candidate header names, then loose match.
function getField(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== "") return row[c];
  }
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = candidates.map(norm);
  for (const key of Object.keys(row)) {
    if (wanted.some((w) => norm(key).includes(w) && w.length > 1)) {
      if (row[key] !== "") return row[key];
    }
  }
  return "";
}

// Parse a value to a number; return null if not a valid number.
function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); // tolerate stray units/commas
  return isNaN(n) ? null : n;
}

// Format a number for display, or show a dash if missing.
function fmt(v, digits = 2) {
  return v === null || isNaN(v) ? "—" : Number(v).toFixed(digits);
}

/* ------------------------------------------------------------
   5. NORMALISE A ROW  ->  a tidy object the app understands
   ------------------------------------------------------------ */
function normaliseRow(row) {
  return {
    name:       getField(row, ["Ponds_data_collection", "Pond", "Pond Name", "Name"]) || "Unnamed pond",
    sampleType: getField(row, ["Sample Type", "Sample_Type", "Type"]) || "—",
    lat:        num(getField(row, ["Latitude", "Lat"])),
    lng:        num(getField(row, ["Longitude", "Long", "Lng", "Lon"])),
    time:       getField(row, ["Time"]),
    rh:         num(getField(row, ["RH (%)", "RH", "Humidity"])),
    wind:       num(getField(row, ["Avg Wind Speed", "Wind"])),
    lux:        num(getField(row, ["Lux"])),
    airTemp:    num(getField(row, ["Air Temp (°C)", "Air Temp", "Air Temperature"])),
    ph:         num(getField(row, ["pH", "PH"])),
    do:         num(getField(row, ["DO (mg/L)", "DO", "Dissolved Oxygen"])),
    ec:         num(getField(row, ["EC (µS/cm)", "EC", "Conductivity"])),
    turbidity:  num(getField(row, ["Turbidity (NTU)", "Turbidity"])),
    waterTemp:  num(getField(row, ["Water Temp (°C)", "Water Temp", "Water Temperature"]))
  };
}

/* ------------------------------------------------------------
   6. BUILD A POPUP for one normalised row
   ------------------------------------------------------------ */
function buildPopup(d) {
  const cls = classifyPh(d.ph);

  const cell = (label, value, full = false) =>
    `<div class="popup__cell${full ? " popup__cell--full" : ""}">
       <div class="popup__k">${label}</div>
       <div class="popup__v">${value}</div>
     </div>`;

  const coords = (d.lat !== null && d.lng !== null)
    ? `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}`
    : "—";

  return `
    <div class="popup">
      <div class="popup__header" style="background:${cls.color}">
        <div class="popup__name">${d.name}</div>
        <div class="popup__time">${d.time || "no time"} · ${cls.label} pH</div>
      </div>
      <div class="popup__grid">
        ${cell("Sample type", d.sampleType, true)}
        ${cell("Latitude / Longitude", coords, true)}
        ${cell("pH", fmt(d.ph))}
        ${cell("DO (mg/L)", fmt(d.do))}
        ${cell("EC (µS/cm)", fmt(d.ec, 0))}
        ${cell("Turbidity (NTU)", fmt(d.turbidity))}
        ${cell("Water Temp (°C)", fmt(d.waterTemp))}
        ${cell("Air Temp (°C)", fmt(d.airTemp))}
        ${cell("RH (%)", fmt(d.rh))}
        ${cell("Avg Wind Speed", fmt(d.wind))}
        ${cell("Lux", fmt(d.lux))}
      </div>
    </div>`;
}

/* ------------------------------------------------------------
   7. RENDER all rows onto the map + update the dashboard
   ------------------------------------------------------------ */
function render(rows) {
  markerLayer.clearLayers(); // remove old markers before redrawing

  const points = [];          // valid lat/lng for fitting bounds
  let phSum = 0, phN = 0;     // running totals for averages
  let doSum = 0, doN = 0;
  let ecSum = 0, ecN = 0;

  rows.forEach((raw) => {
    const d = normaliseRow(raw);

    // Skip rows without valid coordinates (can't map them).
    if (d.lat === null || d.lng === null) return;

    const cls = classifyPh(d.ph);               // -> colour (pH)
    const shape = shapeForType(d.sampleType);   // -> shape (type)

    // A marker whose icon encodes BOTH pieces of information.
    const marker = L.marker([d.lat, d.lng], {
      icon: makeMarkerIcon(shape, cls.color)
    });

    marker.bindPopup(buildPopup(d), { closeButton: true });
    marker.bindTooltip(d.name, { direction: "top" });
    marker.addTo(markerLayer);

    points.push([d.lat, d.lng]);

    // Accumulate stats (only count rows that actually have the value).
    if (d.ph !== null) { phSum += d.ph; phN++; }
    if (d.do !== null) { doSum += d.do; doN++; }
    if (d.ec !== null) { ecSum += d.ec; ecN++; }
  });

  // --- Update dashboard ---
  document.getElementById("stat-count").textContent = points.length;
  document.getElementById("stat-ph").textContent = phN ? (phSum / phN).toFixed(2) : "—";
  document.getElementById("stat-do").textContent = doN ? (doSum / doN).toFixed(2) : "—";
  document.getElementById("stat-ec").textContent = ecN ? Math.round(ecSum / ecN) : "—";

  // --- Fit the map to the data once, on first successful load ---
  if (!hasFitBounds && points.length) {
    map.fitBounds(points, { padding: [60, 60], maxZoom: 16 });
    hasFitBounds = true;
  }
}

/* ------------------------------------------------------------
   8. STATUS PILL helper (the little indicator in the top bar)
   ------------------------------------------------------------ */
function setStatus(state, text) {
  const pill = document.getElementById("status-pill");
  pill.className = "status-pill status-pill--" + state; // live | wait | error
  pill.textContent = text;
}

function stampUpdated() {
  const t = new Date();
  document.getElementById("last-updated").textContent =
    "updated " + t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ------------------------------------------------------------
   9. FETCH + REFRESH LOOP
   ------------------------------------------------------------ */
function usingSampleData() {
  return !CSV_URL || CSV_URL.startsWith("PASTE_YOUR");
}

function loadData() {
  if (usingSampleData()) {
    render(SAMPLE_DATA);
    setStatus("wait", "sample data");
    stampUpdated();
    return;
  }

  // Cache-bust so Google/your browser don't serve a stale CSV on refresh.
  const url = CSV_URL + (CSV_URL.includes("?") ? "&" : "?") + "_t=" + Date.now();

  Papa.parse(url, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const rows = (results.data || []).filter((r) => Object.keys(r).length > 1);
      if (!rows.length) {
        setStatus("error", "empty sheet");
        return;
      }
      render(rows);
      setStatus("live", "live");
      stampUpdated();
    },
    error: (err) => {
      console.error("CSV fetch/parse failed:", err);
      setStatus("error", "fetch failed");
      // Fall back to sample data so the map is never blank.
      if (!hasFitBounds) render(SAMPLE_DATA);
    }
  });
}

// Initial load…
loadData();
// …then refresh on a timer so new Google Sheet rows show up automatically.
setInterval(loadData, REFRESH_MS);
