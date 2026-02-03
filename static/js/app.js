// --- KONFIGURACJA MAPY ---
const crs2180 = new L.Proj.CRS('EPSG:2180',
    '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    {
        resolutions: [32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625],
        origin: [0, 0],
        bounds: L.bounds([0, 0], [2000, 2000])
    }
);

const map = L.map('map', {
    crs: crs2180,
    center: [965, 970],
    zoom: 2,
    zoomControl: false,
    attributionControl: false,
    maxZoom: 11,
    minZoom: 0,
    zoomSnap: 0.5,
    zoomDelta: 0.5
});
L.control.zoom({ position: 'topright' }).addTo(map);

// Warstwa dla trasy
map.createPane('routePane');
map.getPane('routePane').style.zIndex = 450;

// --- KONFIGURACJA ---
const APP_CONFIG = {
    floorColors: {
        'sala': '#feff84', 'uzytkowe': '#e0c1ff', 'wc': '#d0ffff',
        'schody': '#fee2e2', 'windy': '#fee2e2', 'Korytarz': '#f1f5f9'
    },
    sidebarWidth: 0,
    viewPadding: -30
};

/**
 * Centruje mapę na warstwie planu piętra z optymalnym zoomem
 */
function centerMapOnFloorplan() {
    if (!floorplanLayer) return;

    const bounds = floorplanLayer.getBounds();
    const sidebar = window.innerWidth > 800 ? APP_CONFIG.sidebarWidth : 0;

    map.fitBounds(bounds, {
        paddingTopLeft: [sidebar + 20, 30],
        paddingBottomRight: [20, 0],
        animate: true,
        maxZoom: 11
    });

    setTimeout(() => {
        const currentZoom = map.getZoom();
        map.setZoom(currentZoom + 0.25, { animate: true });
    }, 100);
}

// --- SKALOWANIE ETYKIET PRZEZ KLASY CSS ---
function updateLabelScale() {
    const zoom = map.getZoom();
    const mapContainer = document.getElementById('map');

    mapContainer.classList.remove('map-zoom-low', 'map-zoom-med-low', 'map-zoom-med', 'map-zoom-high');
    if (zoom <= 3.5) mapContainer.classList.add('map-zoom-low');
    else if (zoom <= 5.5) mapContainer.classList.add('map-zoom-med-low');
    else if (zoom <= 7.5) mapContainer.classList.add('map-zoom-med');
    else mapContainer.classList.add('map-zoom-high');
}

map.on('zoomend', updateLabelScale);

// --- ZMIENNE GLOBALNE ---
let currentFloor = 0;
let floorplanLayer = null;
let routeDisplayLayer = null;
let html5QrcodeScanner = null;
let locationFloors = {};
let lastRouteData = null;

let initialZoom = null;
let initialCenter = null;

let startSpecificGeometry = null;
let endSpecificGeometry = null;

// Ikony mapy
const startIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});
const endIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});



// --- PRZYCISK QR ---
L.Control.QrScan = L.Control.extend({
    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const button = L.DomUtil.create('a', 'leaflet-control-qr', container);
        button.href = '#'; button.title = 'Skanuj kod QR';
        button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3h6v6H3z"></path><path d="M15 3h6v6h-6z"></path><path d="M3 15h6v6H3z"></path>
            <path d="M14 14h.01"></path><path d="M17 17h.01"></path><path d="M14 17h.01"></path>
            <path d="M17 14h.01"></path><path d="M20 17h.01"></path><path d="M14 20h.01"></path>
            <path d="M17 20h.01"></path><path d="M20 14h1v7h-7v-1"></path>
        </svg>`;
        L.DomEvent.disableClickPropagation(button);
        L.DomEvent.on(button, 'click', function (e) { L.DomEvent.stop(e); startQrScanner(); });
        return container;
    }
});
new L.Control.QrScan({ position: 'topright' }).addTo(map);

// --- LOGIKA SKANERA QR ---
function startQrScanner() {
    document.getElementById('qr-overlay').style.display = 'flex';
    html5QrcodeScanner = new Html5Qrcode("qr-reader");
    html5QrcodeScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess)
        .catch(err => {
            console.error(err); alert("Błąd kamery. Wymagane HTTPS."); stopQrScanner();
        });
}

function stopQrScanner() {
    document.getElementById('qr-overlay').style.display = 'none';
    if (html5QrcodeScanner) html5QrcodeScanner.stop().then(() => html5QrcodeScanner.clear()).catch(console.error);
}

function onScanSuccess(decodedText) {
    stopQrScanner();
    const startSelect = document.getElementById('start-point');
    let found = false;

    for (let i = 0; i < startSelect.options.length; i++) {
        if (startSelect.options[i].value === decodedText) {
            startSelect.selectedIndex = i;
            found = true; break;
        }
    }

    if (found) {
        alert(`Lokalizacja: ${decodedText}`);
        if (locationFloors[decodedText] !== undefined) {
            changeFloor(locationFloors[decodedText]);
        }
        if (window.innerWidth <= 800) document.getElementById('sidebar').classList.add('is-open');
        if (document.getElementById('end-point').value) getRoute();
    } else {
        alert(`Nie rozpoznano kodu: "${decodedText}"`);
    }
}

// --- OBSŁUGA PIĘTER ---
function changeFloor(floor) {
    if (currentFloor === floor && floorplanLayer) return;

    currentFloor = floor;

    document.querySelectorAll('.floor-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-${floor}`);
    if (activeBtn) activeBtn.classList.add('active');

    loadFloorplan();

    if (lastRouteData) {
        drawRouteOnMap(lastRouteData);
    }
}

function loadFloorplan() {
    if (floorplanLayer) map.removeLayer(floorplanLayer);
    if (window.labelsLayer) map.removeLayer(window.labelsLayer);

    let filename = '';
    if (currentFloor === 0) filename = '/static/floorplan_0.geojson';
    else if (currentFloor === -1) filename = '/static/floorplan.geojson';
    else return;

    fetch(filename)
        .then(r => r.json())
        .then(data => {
            const colorMap = APP_CONFIG.floorColors;

            floorplanLayer = L.geoJSON(data, {
                style: (feature) => {
                    const type = feature.properties ? feature.properties.typ : null;
                    return {
                        color: '#94a3b8', weight: 1,
                        fillColor: colorMap[type] || '#ffffff', fillOpacity: 0.8
                    };
                },
                onEachFeature: (feature, layer) => {
                    if (feature.properties && feature.properties.nazwa) {
                        const type = feature.properties.typ || '';

                        const excludedTypes = ['korytarz', 'schody', 'windy'];
                        if (excludedTypes.includes(type.toLowerCase())) {
                            layer.options.interactive = false;
                            return;
                        }

                        const name = feature.properties.nazwa;
                        const geometryStr = JSON.stringify(feature.geometry).replace(/"/g, "&quot;");
                        const popupContent = `
                            <div style="text-align: center;">
                                <strong style="display: block; margin-bottom: 8px; font-size: 14px;">${name}</strong>
                                <div style="display: flex; gap: 8px; justify-content: center;">
                                    <button onclick="window.setStartPoint('${name}', '${geometryStr}')" style="
                                        background: #22c55e; color: white; border: none; padding: 6px 10px; 
                                        border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">
                                        Start
                                    </button>
                                    <button onclick="window.setEndPoint('${name}', '${geometryStr}')" style="
                                        background: #3b82f6; color: white; border: none; padding: 6px 10px; 
                                        border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">
                                        Koniec
                                    </button>
                                </div>
                            </div>
                        `;
                        layer.bindPopup(popupContent, { minWidth: 150 });
                        layer.on('mouseover', function () {
                            this.setStyle({ weight: 2, color: '#3b82f6', fillOpacity: 0.9 });
                        });
                        layer.on('mouseout', function () {
                            floorplanLayer.resetStyle(this);
                        });
                    }
                }
            }).addTo(map);

            floorplanLayer.bringToBack();

            window.labelsLayer = L.layerGroup().addTo(map);

            const labelsByPosition = {};

            data.features.forEach(feature => {
                if (!feature.properties || !feature.properties.nazwa) return;

                const nazwa = feature.properties.nazwa;
                const typ = feature.properties.typ || '';

                if (typ.toLowerCase() === 'korytarz') return;
                const coords = feature.geometry.coordinates[0];
                const ring = Array.isArray(coords[0][0]) ? coords[0] : coords;

                let minLat = Infinity, maxLat = -Infinity;
                let minLng = Infinity, maxLng = -Infinity;

                ring.forEach(coord => {
                    minLng = Math.min(minLng, coord[0]);
                    maxLng = Math.max(maxLng, coord[0]);
                    minLat = Math.min(minLat, coord[1]);
                    maxLat = Math.max(maxLat, coord[1]);
                });

                const centerLat = (minLat + maxLat) / 2;
                const centerLng = (minLng + maxLng) / 2;

                const posKey = `${centerLat.toFixed(6)}_${centerLng.toFixed(6)}`;

                if (!labelsByPosition[posKey]) {
                    labelsByPosition[posKey] = {
                        lat: centerLat,
                        lng: centerLng,
                        names: [],
                        types: []
                    };
                }
                if (!labelsByPosition[posKey].names.includes(nazwa)) {
                    labelsByPosition[posKey].names.push(nazwa);
                    labelsByPosition[posKey].types.push(typ.toLowerCase());
                }
            });

            Object.values(labelsByPosition).forEach(pos => {
                let displayName;
                let labelClass;
                if (pos.names.includes('Winda') && pos.names.includes('Schody')) {
                    displayName = 'Winda/Schody';
                    labelClass = 'room-label room-label-schody';
                } else {
                    displayName = pos.names[0];
                    labelClass = 'room-label room-label-' + pos.types[0];
                }

                const labelIcon = L.divIcon({
                    className: labelClass,
                    html: '<span>' + displayName + '</span>',
                    iconSize: [1, 1],
                    iconAnchor: [0, 0]
                });

                L.marker([pos.lat, pos.lng], {
                    icon: labelIcon,
                    interactive: false
                }).addTo(window.labelsLayer);
            });

            setTimeout(updateLabelScale, 100);
            if (!lastRouteData && !window.initialLoadDone) {
                centerMapOnFloorplan();
                window.initialLoadDone = true;
                setTimeout(() => {
                    initialZoom = map.getZoom();
                    initialCenter = map.getCenter();
                }, 200);
            }
        })
        .catch(() => {});
}

// --- POBIERANIE DANYCH I BUDOWANIE DROPDOWNÓW ---
function populateDropdowns() {
    fetch('/api/locations')
        .then(r => r.json())
        .then(data => {
            const groups = data.groups;
            locationFloors = data.floors;
            const typeLabels = { 'sala': 'Sale', 'uzytkowe': 'Pomieszczenia użytkowe', 'wc': 'Toalety', 'wejscia': 'Wejścia' };

            setupSearchableDropdown('start-select-wrapper', 'start-point', groups, typeLabels);
            setupSearchableDropdown('end-select-wrapper', 'end-point', groups, typeLabels);
            const urlParams = new URLSearchParams(window.location.search);
            const startParam = urlParams.get('start');
            if (startParam) {
                window.setStartPoint(startParam);
            }
        });
}

function setupSearchableDropdown(wrapperId, hiddenInputId, groups, typeLabels) {
    const wrapper = document.getElementById(wrapperId);
    const input = wrapper.querySelector('.search-input');
    const list = wrapper.querySelector('.options-list');
    const hiddenInput = document.getElementById(hiddenInputId);

    let allItems = [];
    Object.keys(groups).sort().forEach(typ => {
        const label = typeLabels[typ] || typ;
        const items = groups[typ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        allItems.push({ type: label, items: items });
    });

    function renderOptions(filterText = '') {
        list.innerHTML = '';
        const filter = filterText.toLowerCase();
        let hasResults = false;

        allItems.forEach(group => {
            const filteredItems = group.items.filter(item => item.toLowerCase().includes(filter));
            if (filteredItems.length > 0) {
                const groupLabel = document.createElement('div');
                groupLabel.className = 'option-group-label';
                groupLabel.textContent = group.type;
                list.appendChild(groupLabel);

                filteredItems.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'option-item';
                    div.textContent = item;
                    if (item === hiddenInput.value) div.classList.add('selected');

                    div.addEventListener('click', () => {
                        selectItem(item);
                    });
                    list.appendChild(div);
                });
                hasResults = true;
            }
        });

        if (!hasResults) {
            const noRes = document.createElement('div');
            noRes.className = 'option-item';
            noRes.style.color = '#9ca3af';
            noRes.style.cursor = 'default';
            noRes.textContent = 'Brak wyników';
            list.appendChild(noRes);
        }
    }

    function selectItem(value) {
        hiddenInput.value = value;
        input.value = value;
        list.classList.remove('show');
        if (hiddenInputId === 'start-point') {
            startSpecificGeometry = null;
            if (locationFloors[value] !== undefined) changeFloor(locationFloors[value]);
            if (window.innerWidth <= 800) document.getElementById('sidebar').classList.add('is-open');
        } else if (hiddenInputId === 'end-point') {
            endSpecificGeometry = null;
        }
    }


    input.addEventListener('focus', () => {
        renderOptions(input.value);
        list.classList.add('show');
    });

    input.addEventListener('input', () => {
        renderOptions(input.value);
        list.classList.add('show');
    });


    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            list.classList.remove('show');
        }
    });
}

// --- ROUTING ---
function getRoute() {
    const start = document.getElementById('start-point').value;
    const end = document.getElementById('end-point').value;
    const avoidStairs = document.getElementById('avoid-stairs').checked;
    const button = document.getElementById('route-button');
    const routeInfoDiv = document.getElementById('route-info');

    if (!start || !end) { alert('Wybierz oba punkty!'); return; }

    button.classList.add('loading');
    button.textContent = 'Wyznaczanie...';
    routeInfoDiv.innerHTML = '';

    if (locationFloors[start] !== undefined && locationFloors[start] != currentFloor) {
        changeFloor(locationFloors[start]);
    }


    fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            start: start,
            end: end,
            avoid_stairs: avoidStairs,
            start_geometry: startSpecificGeometry,
            end_geometry: endSpecificGeometry
        })
    })
        .then(r => r.json())
        .then(data => {
            button.classList.remove('loading');
            button.textContent = 'Wyznacz trasę';

            if (data.error) { alert(data.error); return; }

            lastRouteData = data;
            drawRouteOnMap(data);

            const distance = Math.round(data.distance);
            const startFloor = locationFloors[start];
            const endFloor = locationFloors[end];

            let msg = `<h3>Informacje o trasie</h3>
               <p><strong>Dystans:</strong> <span class="distance-value">${distance}</span> metrów</p>`;

            if (startFloor !== endFloor) {
                msg += `<span class="floor-warning">Trasa wielopiętrowa (${startFloor} ⮕ ${endFloor}). Użyj przycisków po prawej.</span>`;
            }
            routeInfoDiv.innerHTML = msg;

            document.getElementById('clear-route-button').style.display = 'block';

            if (window.innerWidth <= 800) document.getElementById('sidebar').classList.remove('is-open');
        })
        .catch(err => {
            button.classList.remove('loading'); button.textContent = 'Wyznacz trasę';
            console.error(err); alert('Błąd serwera.');
        });
}

function clearRoute() {
    if (routeDisplayLayer) {
        map.removeLayer(routeDisplayLayer);
        routeDisplayLayer = null;
    }

    lastRouteData = null;

    document.getElementById('start-point').value = '';
    document.getElementById('end-point').value = '';
    document.getElementById('start-point-input').value = '';
    document.getElementById('end-point-input').value = '';

    startSpecificGeometry = null;
    endSpecificGeometry = null;

    document.getElementById('route-info').innerHTML = '';
    document.getElementById('clear-route-button').style.display = 'none';
    if (initialZoom !== null && initialCenter !== null) {
        map.setView(initialCenter, initialZoom, { animate: true });
    }
}

function drawRouteOnMap(data) {
    if (routeDisplayLayer) map.removeLayer(routeDisplayLayer);
    routeDisplayLayer = L.layerGroup().addTo(map);

    let hasVisibleContent = false;
    const allBounds = [];

    if (data.segments) {
        data.segments.forEach((seg) => {
            const segType = seg.typ;

            if (segType === 'pion') return;
            const isOnCurrentFloor = seg.pietro == currentFloor;

            if (isOnCurrentFloor) {
                const style = { color: '#007aff', weight: 6, opacity: 0.9 };

                const geoLayer = L.geoJSON(seg.geometry, {
                    style: style,
                    pane: 'routePane'
                }).addTo(routeDisplayLayer);

                allBounds.push(geoLayer.getBounds());
                hasVisibleContent = true;
            }
        });
    }

    const start = document.getElementById('start-point').value;
    const end = document.getElementById('end-point').value;
    const actualStartFloor = data.start_floor !== undefined ? data.start_floor : locationFloors[start];
    const actualEndFloor = data.end_floor !== undefined ? data.end_floor : locationFloors[end];

    if (data.start_point && actualStartFloor == currentFloor) {
        const geo = JSON.parse(data.start_point);
        const latlng = [geo.coordinates[1], geo.coordinates[0]];
        L.marker(latlng, { icon: startIcon }).bindPopup(`<b>Start:</b> ${start}`).addTo(routeDisplayLayer);
    }

    if (data.end_point && actualEndFloor == currentFloor) {
        const geo = JSON.parse(data.end_point);
        const latlng = [geo.coordinates[1], geo.coordinates[0]];
        L.marker(latlng, { icon: endIcon }).bindPopup(`<b>Koniec:</b> ${end}`).addTo(routeDisplayLayer);
    }

    if (hasVisibleContent && allBounds.length > 0) {
        let combinedBounds = allBounds[0];
        for (let i = 1; i < allBounds.length; i++) {
            combinedBounds.extend(allBounds[i]);
        }

        const ne = combinedBounds.getNorthEast();
        const sw = combinedBounds.getSouthWest();
        const span = Math.max(Math.abs(ne.lng - sw.lng), Math.abs(ne.lat - sw.lat));

        let padding = [25, 25];
        if (span < 40) padding = [60, 60];
        else if (span < 80) padding = [60, 60];
        map.fitBounds(combinedBounds, {
            padding: padding, animate: true, duration: 0.8, maxZoom: 10
        });
    } else if (floorplanLayer) {
        map.fitBounds(floorplanLayer.getBounds(), { padding: [20, 20], animate: true });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    document.getElementById('menu-toggle').addEventListener('click', (e) => {
        e.stopPropagation(); sidebar.classList.toggle('is-open');
    });
    map.on('click', () => sidebar.classList.remove('is-open'));

    document.getElementById('route-button').addEventListener('click', getRoute);
    document.getElementById('clear-route-button').addEventListener('click', clearRoute);

    document.getElementById('swap-button').addEventListener('click', () => {
        const sHidden = document.getElementById('start-point');
        const eHidden = document.getElementById('end-point');
        const sInput = document.getElementById('start-point-input');
        const eInput = document.getElementById('end-point-input');

        // Swap values
        const tempVal = sHidden.value;
        sHidden.value = eHidden.value;
        eHidden.value = tempVal;

        // Swap text
        const tempText = sInput.value;
        sInput.value = eInput.value;
        eInput.value = tempText;
        if (sHidden.value && locationFloors[sHidden.value] !== undefined) {
            changeFloor(locationFloors[sHidden.value]);
        }
    });

    populateDropdowns();
    changeFloor(-1);
});

// --- FUNKCJE DO POPUPÓW ---
window.setStartPoint = function (name, geometryStr) {
    const hidden = document.getElementById('start-point');
    const input = document.getElementById('start-point-input');

    hidden.value = name;
    input.value = name;
    if (geometryStr) {
        try {
            startSpecificGeometry = JSON.parse(geometryStr.replace(/&quot;/g, '"'));
        } catch (e) {
            console.error("Invalid geometry JSON", e);
            startSpecificGeometry = null;
        }
    } else {
        startSpecificGeometry = null;
        if (locationFloors[name] !== undefined) changeFloor(locationFloors[name]);
    }

    if (window.innerWidth <= 800) document.getElementById('sidebar').classList.add('is-open');
    map.closePopup();
}

window.setEndPoint = function (name, geometryStr) {
    const hidden = document.getElementById('end-point');
    const input = document.getElementById('end-point-input');

    hidden.value = name;
    input.value = name;
    if (geometryStr) {
        try {
            endSpecificGeometry = JSON.parse(geometryStr.replace(/&quot;/g, '"'));
        } catch (e) {
            console.error("Invalid geometry JSON", e);
            endSpecificGeometry = null;
        }
    } else {
        endSpecificGeometry = null;
    }

    if (window.innerWidth <= 800) document.getElementById('sidebar').classList.add('is-open');
    map.closePopup();
    if (document.getElementById('start-point').value) {
        getRoute();
    }
}
