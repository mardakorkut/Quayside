/**
 * MapLibre GL JS Map Configuration
 * Professional map initialization with modern styling
 */

let map;
let markers = new Map();
let activeRoute = null;
let lastZoomedVessel = null;
let mapMoveTimeout = null;
let lastBounds = null;

// ==================== UTILITY FUNCTIONS ====================

/**
 * İki nokta arası mesafe hesaplama (Haversine formula - nautical miles)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // Dünya yarıçapı (nautical miles)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // nautical miles
}

/**
 * ETA hesaplama
 */
function calculateETA(distance, speed) {
    if (!speed || speed <= 0) return null;
    
    const hours = distance / speed;
    const eta = new Date();
    eta.setHours(eta.getHours() + hours);
    
    return {
        hours: Math.floor(hours),
        minutes: Math.round((hours % 1) * 60),
        arrivalTime: eta.toLocaleString('tr-TR', { 
            day: '2-digit', 
            month: 'short', 
            hour: '2-digit', 
            minute: '2-digit' 
        })
    };
}

// ==================== CUSTOM MAP CONTROLS ====================

let isDarkMode = false;

// Location Control
class LocationControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        
        this._button = document.createElement('button');
        this._button.className = 'maplibregl-ctrl-icon';
        this._button.type = 'button';
        this._button.innerHTML = '<i class="fas fa-location-arrow" style="font-size: 14px;"></i>';
        this._button.title = 'Go to my location';
        this._button.onclick = () => this._goToLocation();
        
        this._container.appendChild(this._button);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
    
    _goToLocation() {
        if (!navigator.geolocation) {
            showToast('⚠️ Geolocation not supported', 'error');
            return;
        }

        this._button.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 14px;"></i>';

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                
                this._map.flyTo({
                    center: [longitude, latitude],
                    zoom: 12,
                    speed: 1.2
                });
                
                this._button.innerHTML = '<i class="fas fa-location-arrow" style="font-size: 14px;"></i>';
                showToast('✅ Moved to your location', 'success');
            },
            (error) => {
                this._button.innerHTML = '<i class="fas fa-location-arrow" style="font-size: 14px;"></i>';
                showToast('⚠️ Could not get location', 'error');
                console.error('Geolocation error:', error);
            }
        );
    }
}

// Dark Mode Control
class DarkModeControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        
        this._button = document.createElement('button');
        this._button.className = 'maplibregl-ctrl-icon';
        this._button.type = 'button';
        this._button.innerHTML = '<i class="fas fa-moon" style="font-size: 14px;"></i>';
        this._button.title = 'Toggle dark mode';
        this._button.onclick = () => this._toggleDarkMode();
        
        this._container.appendChild(this._button);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
    
    _toggleDarkMode() {
        isDarkMode = !isDarkMode;
        
        const newStyle = {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
                'map-tiles': {
                    type: 'raster',
                    tiles: isDarkMode 
                        ? [
                            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
                        ]
                        : [
                            'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                            'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                            'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
                        ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                }
            },
            layers: [{
                id: 'map-layer',
                type: 'raster',
                source: 'map-tiles',
                minzoom: 0,
                maxzoom: 22
            }]
        };
        
        // Store current vessels data
        const vesselsSource = this._map.getSource('vessels');
        const routeSource = this._map.getSource('route');
        const vesselsData = vesselsSource ? vesselsSource._data : { type: 'FeatureCollection', features: [] };
        const routeData = routeSource ? routeSource._data : { type: 'FeatureCollection', features: [] };
        
        this._map.setStyle(newStyle);
        
        // Re-add vessel layers after style loads
        this._map.once('style.load', () => {
            // Re-add vessels source (no clustering)
            this._map.addSource('vessels', {
                type: 'geojson',
                data: vesselsData,
                cluster: false
            });
            
            // Re-add route source
            this._map.addSource('route', {
                type: 'geojson',
                data: routeData
            });
            
            // Re-add all layers
            addVesselLayers();
            addRouteLayers();
            
            console.log('✅ Dark mode:', isDarkMode ? 'ON' : 'OFF');
        });
        
        this._button.innerHTML = isDarkMode 
            ? '<i class="fas fa-sun" style="font-size: 14px;"></i>'
            : '<i class="fas fa-moon" style="font-size: 14px;"></i>';
        
        showToast(isDarkMode ? '🌙 Dark mode enabled' : '☀️ Light mode enabled', 'success');
    }
}

class CompassControl {
    onAdd(mapInstance) {
        this._map = mapInstance;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group map-compass-control';
        this._container.innerHTML = `
            <button class="compass-btn" title="Map bearing">
                <i class="fas fa-compass"></i>
                <span class="compass-value">0°</span>
            </button>
        `;

        this._icon = this._container.querySelector('i');
        this._value = this._container.querySelector('.compass-value');

        this._update = () => {
            const bearing = this._map.getBearing();
            const normalized = (bearing % 360 + 360) % 360;
            this._value.textContent = `${Math.round(normalized)}°`;
            this._icon.style.transform = `rotate(${normalized}deg)`;
        };

        this._map.on('rotate', this._update);
        this._map.on('load', this._update);
        this._update();

        return this._container;
    }

    onRemove() {
        if (this._map) {
            this._map.off('rotate', this._update);
            this._map.off('load', this._update);
        }
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

function initializeMap() {
    // Initialize MapLibre GL JS map with dark style
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
                'osm': {
                    type: 'raster',
                    tiles: [
                        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                        'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
                    ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                }
            },
            layers: [{
                id: 'osm-layer',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 19
            }]
        },
        center: [28.9784, 41.0082],  // Istanbul
        zoom: 5,
        pitch: 0,
        bearing: 0
    });

    // Add map controls
    map.addControl(new CompassControl(), 'top-right');
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({
        maxWidth: 100,
        unit: 'nautical'
    }));

    // Add fullscreen control
    map.addControl(new maplibregl.FullscreenControl());
    
    // Add custom location button
    map.addControl(new LocationControl(), 'top-right');
    
    // Add custom dark mode toggle
    map.addControl(new DarkModeControl(), 'top-right');

    map.on('load', function() {
        console.log('✅ Map loaded successfully');
        
        // Initialize GeoJSON sources for vessels
        map.addSource('vessels', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            },
            cluster: false
        });
        
        // Add vessel layers
        addVesselLayers();
        
        // Add route source and layers
        map.addSource('route', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
        
        addRouteLayers();
        
        // Map move handler for dynamic BBOX
        map.on('moveend', handleMapMove);

        // Initialize dynamic BBOX on load
        const bounds = map.getBounds();
        const initialBounds = {
            minLat: bounds.getSouth(),
            minLon: bounds.getWest(),
            maxLat: bounds.getNorth(),
            maxLon: bounds.getEast()
        };
        if (typeof window.updateViewportBounds === 'function') {
            window.updateViewportBounds(initialBounds);
        }
        if (typeof window.searchCurrentView === 'function') {
            window.searchCurrentView({ silent: true });
        }
    });

    map.on('error', function(error) {
        console.error('❌ Map error:', error);
    });
}

// ==================== LAYER HELPERS ====================

function addTriangleSvgIcon(onReady) {
    const makeTriangle = (id, fill, stroke) => {
        if (map.hasImage(id)) return;
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path d='M16 2 L26 26 Q16 22 6 26 Z' fill='${fill}' stroke='${stroke}' stroke-width='1.6' stroke-linejoin='round' stroke-linecap='round'/></svg>`;
        const img = new Image();
        img.onload = () => {
            map.addImage(id, img, { sdf: false, pixelRatio: 2 });
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    };

    // Core categories: bright primary colors
    makeTriangle('triangle-tanker', '#3b82f6', '#1d4ed8');
    makeTriangle('triangle-container', '#ef4444', '#b91c1c');
    makeTriangle('triangle-cargo', '#22c55e', '#15803d');

    // Secondary categories: muted tones
    makeTriangle('triangle-passenger', '#c47c6a', '#8f5a4d');
    makeTriangle('triangle-fishing', '#8aa57a', '#5f7454');
    makeTriangle('triangle-tug', '#a58bb9', '#6f5a86');
    makeTriangle('triangle-pilot', '#7fa7b3', '#4f6c74');
    makeTriangle('triangle-other', '#b7838c', '#7a5660');

    if (onReady) onReady();
}

function addVesselLayers() {
    addTriangleSvgIcon(() => {
        addVesselTriangleLayer();
        registerVesselLayerHandlers();
    });
}

function addTriangleIcon() {
    if (map.hasImage('triangle-icon')) return;

    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(size / 2, 4);
    ctx.lineTo(size - 4, size - 6);
    ctx.lineTo(4, size - 6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();

    map.addImage('triangle-icon', canvas, { sdf: true, pixelRatio: 2 });
}

function addVesselTriangleLayer() {
    // Marine Traffic style triangle markers with heading direction
    map.addLayer({
        id: 'vessel-points',
        type: 'symbol',
        source: 'vessels',
        filter: ['!', ['has', 'point_count']],
        layout: {
            'icon-image': [
                'match',
                ['get', 'ship_category'],
                'Tanker', 'triangle-tanker',
                'Container', 'triangle-container',
                'Cargo', 'triangle-cargo',
                'Passenger', 'triangle-passenger',
                'Fishing', 'triangle-fishing',
                'Tug', 'triangle-tug',
                'Pilot', 'triangle-pilot',
                'triangle-other'
            ],
            'icon-size': 1.05,
            'icon-rotate': ['coalesce', ['get', 'heading'], 0],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        },
        paint: {
            'icon-opacity': 0.95
        }
    });

}

function addVesselCircleLayer() {
    // Circle vessel markers with color by ship type
    map.addLayer({
        id: 'vessel-points',
        type: 'circle',
        source: 'vessels',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'match',
                ['get', 'ship_category'],
                'Tanker', '#4a90e2',
                'Container', '#ff6b6b',
                'Cargo', '#2ecc71',
                '#6c757d'
            ],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
        }
    });
}

function registerVesselLayerHandlers() {
    // Click handler for vessels
    map.on('click', 'vessel-points', (e) => {
        const feature = e.features[0];
        const props = feature.properties;

        // Create popup content
        const popupContent = `
            <div class="vessel-popup">
                <h3>🚢 ${props.name || 'Unknown Vessel'}</h3>
                <div class="popup-details">
                    <p><strong>MMSI</strong><span>${props.mmsi}</span></p>
                    ${props.imo ? `<p><strong>IMO</strong><span>${props.imo}</span></p>` : ''}
                    ${props.callsign ? `<p><strong>Call Sign</strong><span>${props.callsign}</span></p>` : ''}
                    <p><strong>Type</strong><span>${props.display_type || props.ship_category || 'Other'}</span></p>
                    ${props.destination ? `<p><strong>Destination</strong><span>${props.destination}</span></p>` : ''}
                    <p><strong>Speed</strong><span>${props.speed || 0} kts</span></p>
                    <p><strong>Course</strong><span>${props.course || 0}°</span></p>
                    ${props.eta ? `<p><strong>ETA</strong><span>${props.eta}</span></p>` : ''}
                </div>
            </div>
        `;

        new maplibregl.Popup()
            .setLngLat(feature.geometry.coordinates)
            .setHTML(popupContent)
            .addTo(map);
    });

    // Change cursor on hover
    map.on('mouseenter', 'vessel-points', () => {
        map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'vessel-points', () => {
        map.getCanvas().style.cursor = '';
    });
}

function addRouteLayers() {
    // Route line
    map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
            'line-color': '#58a6ff',
            'line-width': 3,
            'line-dasharray': [2, 2]
        }
    });
    
    // Route points
    map.addLayer({
        id: 'route-points',
        type: 'circle',
        source: 'route',
        paint: {
            'circle-radius': 6,
            'circle-color': '#58a6ff',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });
}

// ==================== DYNAMIC BBOX ====================

function handleMapMove() {
    clearTimeout(mapMoveTimeout);
    
    mapMoveTimeout = setTimeout(() => {
        const bounds = map.getBounds();
        const currentBounds = {
            minLat: bounds.getSouth(),
            minLon: bounds.getWest(),
            maxLat: bounds.getNorth(),
            maxLon: bounds.getEast()
        };
        
        // Check if bounds changed significantly (>20%)
        if (lastBounds) {
            const latDiff = Math.abs(currentBounds.maxLat - lastBounds.maxLat);
            const lonDiff = Math.abs(currentBounds.maxLon - lastBounds.maxLon);
            const latRange = currentBounds.maxLat - currentBounds.minLat;
            const lonRange = currentBounds.maxLon - currentBounds.minLon;
            
            if (latDiff / latRange < 0.2 && lonDiff / lonRange < 0.2) {
                return; // Not significant change
            }
        }
        
        lastBounds = currentBounds;
        console.log('🗺️ Map moved, new bounds:', currentBounds);
        
        if (typeof window.updateViewportBounds === 'function') {
            window.updateViewportBounds(currentBounds);
        }
        if (typeof window.searchCurrentView === 'function') {
            window.searchCurrentView({ silent: true });
        }
    }, 500); // 500ms debounce
}

// Update vessels on map (GeoJSON)
function updateVesselsOnMap(vessels) {
    if (!map || !map.getSource('vessels')) return;

    const inferShipCategory = (vessel) => {
        const category = vessel.ship_category;
        if (category && category !== 'Other') return category;

        const type = (vessel.ship_type || '').toLowerCase();
        if (type.includes('tanker') || type.includes('oil') || type.includes('lng') || type.includes('lpg')) return 'Tanker';
        if (type.includes('container')) return 'Container';
        if (type.includes('cargo') || type.includes('bulk') || type.includes('general')) return 'Cargo';
        if (type.includes('passenger')) return 'Passenger';
        if (type.includes('fishing')) return 'Fishing';
        if (type.includes('tug')) return 'Tug';
        if (type.includes('pilot')) return 'Pilot';
        return 'Other';
    };
    
    const features = vessels.map(vessel => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [vessel.longitude, vessel.latitude]
        },
        properties: {
            mmsi: vessel.mmsi,
            name: vessel.name,
            imo: vessel.imo,
            callsign: vessel.callsign,
            speed: vessel.speed,
            course: vessel.course ?? vessel.heading,
            heading: vessel.heading || 0,
            destination: vessel.destination,
            ship_type: vessel.ship_type,
            display_type: vessel.ship_type || vessel.ship_category || 'Other',
            is_ballast: vessel.is_ballast || false,
            is_anchored: vessel.is_anchored || false,
            is_stationary: vessel.is_stationary || false,
            ship_category: inferShipCategory(vessel)
        }
    }));
    
    map.getSource('vessels').setData({
        type: 'FeatureCollection',
        features: features
    });
}

// Handle vessel click for route display
function handleVesselClick(mmsi) {
    const vessel = allVessels.get(mmsi);
    if (!vessel) return;
    
    const currentMMSI = window.currentVesselMMSI;
    const isThisVesselShown = currentMMSI && currentMMSI.toString() === mmsi.toString();
    
    if (isThisVesselShown) {
        clearRoute();
    } else {
        clearRoute();
        
        if (vessel.destination && vessel.destination !== '--') {
            const destCoords = getDestinationCoords(vessel.destination);
            if (destCoords) {
                const destObj = { lon: destCoords.lon, lat: destCoords.lat };
                drawRouteLine(vessel, destObj);
                addDestinationMarker(destCoords, vessel.destination);
                activeRoute = { mmsi: vessel.mmsi, destination: vessel.destination };
                
                if (lastZoomedVessel !== mmsi.toString()) {
                    const bounds = [
                        [Math.min(vessel.longitude, destCoords.lon), Math.min(vessel.latitude, destCoords.lat)],
                        [Math.max(vessel.longitude, destCoords.lon), Math.max(vessel.latitude, destCoords.lat)]
                    ];
                    
                    map.fitBounds(bounds, {
                        padding: { top: 100, bottom: 100, left: 350, right: 380 },
                        duration: 1000
                    });
                    
                    lastZoomedVessel = mmsi.toString();
                }
            }
        }
    }
}

// Legacy marker system (keep for backward compatibility)
function addVesselMarker(vessel) {
    // Just update GeoJSON instead
    const allVesselsArray = Array.from(allVessels.values());
    updateVesselsOnMap(allVesselsArray);
}

/**
 * Gemi rotasını göster/gizle (toggle)
 */
function toggleVesselRoute(vessel) {
    // Eğer bu gemi için zaten rota varsa, kaldır
    if (activeRoute && activeRoute.mmsi === vessel.mmsi) {
        clearRoute();
        return;
    }
    
    // Önce varolan rotayı temizle
    clearRoute();
    
    // Yeni rota çiz (eğer destination varsa)
    if (!vessel.destination || vessel.destination === '--') {
        showToast('No destination data available', 'warning');
        return;
    }
    
    // Destination koordinatlarını tahmin et (gerçek API'de gelecek)
    // Şimdilik Istanbul koordinatları kullan
    const destinationCoords = getDestinationCoords(vessel.destination);
    
    if (!destinationCoords) {
        showToast('Could not determine destination coordinates', 'warning');
        return;
    }
    
    // Çizgi çiz
    drawRouteLine(vessel, destinationCoords);
    
    // Destination marker ekle
    addDestinationMarker(destinationCoords, vessel.destination);
    
    // Aktif rotayı sakla
    if (!activeRoute) activeRoute = {};
    activeRoute.mmsi = vessel.mmsi;
    activeRoute.destination = destinationCoords;
}

/**
 * Rota çizgisini çiz
 */
function drawRouteLine(vessel, destination) {
    const routeGeoJSON = {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: [
                [vessel.longitude, vessel.latitude],
                [destination.lon, destination.lat]
            ]
        }
    };
    
    // Kaynak ve katman varsa kaldır
    if (map.getSource('route')) {
        map.removeLayer('route-line');
        map.removeLayer('route-arrow');
        map.removeSource('route');
    }
    
    // Yeni kaynak ekle
    map.addSource('route', {
        type: 'geojson',
        data: routeGeoJSON
    });
    
    // Çizgi katmanı
    map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': '#0066cc',
            'line-width': 3,
            'line-dasharray': [2, 2]
        }
    });
}

/**
 * Varış noktası marker ekle
 */
function addDestinationMarker(coords, name) {
    const el = document.createElement('div');
    el.className = 'destination-marker';
    el.innerHTML = '🎯';
    el.style.fontSize = '24px';
    el.style.cursor = 'pointer';
    
    const marker = new maplibregl.Marker({ element: el })
        .setLngLat([coords.lon, coords.lat])
        .setPopup(new maplibregl.Popup({ offset: 15 }).setHTML(`
            <div style="font-family: Arial; text-align: center;">
                <strong>Destination</strong><br>${name}
            </div>
        `))
        .addTo(map);
    
    // activeRoute'a marker'ı ekle
    if (!activeRoute) activeRoute = {};
    activeRoute.destinationMarker = marker;
}

/**
 * Rotayı temizle
 */
function clearRoute() {
    if (map.getSource('route')) {
        map.removeLayer('route-line');
        if (map.getLayer('route-arrow')) map.removeLayer('route-arrow');
        map.removeSource('route');
    }
    
    if (activeRoute && activeRoute.destinationMarker) {
        activeRoute.destinationMarker.remove();
    }
    
    activeRoute = null;
}

/**
 * Destination koordinatlarını al (basit version)
 */
function getDestinationCoords(destination) {
    if (!destination || destination === '--' || destination === 'N/A') return null;
    
    // Geniş port ve liman veritabanı (Akdeniz, Ege, Marmara)
    const ports = {
        // Türkiye
        'Istanbul': { lat: 41.0082, lon: 28.9784 },
        'Izmir': { lat: 38.4189, lon: 27.1287 },
        'Mersin': { lat: 36.7400, lon: 34.6249 },
        'Antalya': { lat: 36.7465, lon: 30.7133 },
        'Aliaga': { lat: 38.9486, lon: 26.9622 },
        'Tekirdağ': { lat: 40.3592, lon: 27.4831 },
        'Gemlik': { lat: 40.4319, lon: 29.1756 },
        'Erdek': { lat: 40.3517, lon: 27.9864 },
        'Çanakkale': { lat: 40.1553, lon: 26.4142 },
        
        // Yunanistan
        'Piraeus': { lat: 37.9478, lon: 23.6463 },
        'Thessaloniki': { lat: 40.6401, lon: 22.9444 },
        'Patras': { lat: 38.2515, lon: 21.7313 },
        'Volos': { lat: 39.3614, lon: 22.9375 },
        
        // Bulgaristan & Romanya
        'Burgas': { lat: 42.5048, lon: 27.4626 },
        'Varna': { lat: 43.2076, lon: 27.9285 },
        'Constanta': { lat: 44.1680, lon: 28.6580 },
        
        // Mısır
        'Alexandria': { lat: 31.2957, lon: 29.9526 },
        'Port Said': { lat: 31.2565, lon: 32.3039 },
        'Suez': { lat: 29.9668, lon: 32.3469 },
        
        // İtalya
        'Genova': { lat: 44.4056, lon: 8.9142 },
        'Trieste': { lat: 45.6452, lon: 13.7778 },
        'Venice': { lat: 45.4408, lon: 12.3155 },
        'Naples': { lat: 40.8335, lon: 14.2694 },
        
        // Malta & Kıbrıs
        'Valletta': { lat: 35.8989, lon: 14.5146 },
        'Limassol': { lat: 34.6749, lon: 33.0382 },
        
        // Kuzey Afrika
        'Tangier': { lat: 35.7595, lon: -5.8330 },
        'Casablanca': { lat: 33.5731, lon: -7.5898 },
        'Algiers': { lat: 36.7538, lon: 3.0588 }
    };
    
    const destUpper = destination.toUpperCase().trim();
    
    // Exact match first
    for (let port in ports) {
        if (destUpper === port.toUpperCase()) {
            return ports[port];
        }
    }
    
    // Case-insensitive partial match
    for (let port in ports) {
        if (destUpper.includes(port.toUpperCase())) {
            return ports[port];
        }
    }
    
    // Try reverse: port name in destination
    for (let port in ports) {
        if (port.toLowerCase().includes(destUpper.toLowerCase().substring(0, 5))) {
            return ports[port];
        }
    }
    
    return null;
}

function updateVesselMarker(vessel) {
    const { mmsi, latitude, longitude, heading } = vessel;
    const markerData = markers.get(mmsi);

    if (markerData) {
        // Update position
        markerData.marker.setLngLat([longitude, latitude]);

        // Update rotation
        if (markerData.element.firstChild) {
            markerData.element.firstChild.style.transform = `rotate(${heading || 0}deg)`;
        }

        // Update stored data
        markerData.vessel = vessel;
    } else {
        // Add new marker if doesn't exist
        addVesselMarker(vessel);
    }
}

function removeVesselMarker(mmsi) {
    const markerData = markers.get(mmsi);
    if (markerData) {
        markerData.marker.remove();
        markers.delete(mmsi);
    }
}

function showVesselInfo(vessel) {
    const { name, mmsi, callsign, speed, heading, destination, ship_type, ship_category } = vessel;

    const info = document.getElementById('vessel-info');
    document.getElementById('info-name').textContent = name;
    document.getElementById('info-mmsi').textContent = mmsi;
    document.getElementById('info-callsign').textContent = callsign || 'N/A';
    document.getElementById('info-speed').textContent = `${speed} knots`;
    document.getElementById('info-heading').textContent = `${heading}°`;
    document.getElementById('info-destination').textContent = destination || 'N/A';
    document.getElementById('info-type').textContent = ship_type || ship_category || 'Other';

    info.style.display = 'block';
}

function zoomIn() {
    map.zoomIn();
}

function zoomOut() {
    map.zoomOut();
}

function resetMap() {
    map.flyTo({
        center: [28.9784, 41.0082],
        zoom: 5,
        duration: 1000
    });
    clearRoute(); // Rotayı da temizle
}

// ==================== GEOLOCATION ====================

function goToMyLocation() {
    if (!navigator.geolocation) {
        showToast('⚠️ Geolocation is not supported by your browser', 'error');
        return;
    }

    showToast('📍 Getting your location...', 'info');

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            
            map.flyTo({
                center: [longitude, latitude],
                zoom: 12,
                speed: 1.2,
                curve: 1.5
            });
            
            showToast('✅ Moved to your location', 'success');
        },
        (error) => {
            let message = 'Failed to get your location';
            
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    message = '⚠️ Location permission denied';
                    break;
                case error.POSITION_UNAVAILABLE:
                    message = '⚠️ Location information unavailable';
                    break;
                case error.TIMEOUT:
                    message = '⚠️ Location request timed out';
                    break;
            }
            
            showToast(message, 'error');
            console.error('Geolocation error:', error);
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        }
    );
}

// Export functions
window.getDestinationCoords = getDestinationCoords;
window.calculateDistance = calculateDistance;
window.calculateETA = calculateETA;
window.clearRoute = clearRoute;
window.goToMyLocation = goToMyLocation;

// Initialize map when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMap);
} else {
    initializeMap();
}
