/**
 * Vessel Tracker Main Application Logic
 * Handles UI interactions and API calls
 * Quayside - Professional Vessel Tracking Platform
 */

let myVessels = new Map();      // User's tracked vessels (from database)
let aisVessels = new Map();     // Live AIS stream vessels (background collection)
let allVessels = new Map();     // Combined vessels for display on map
let activeFilters = new Set();
let filterTimeout = null;
let showAllVessels = true;     // Default: show all AIS vessels like MarineTraffic
let aisStreamConnected = false; // Track if AIS stream is collecting data
let aisWebSocket = null;
let aisReconnectTimeout = null;
let currentViewportBounds = null;
const dynamicBBoxEnabled = true;

let currentListView = 'tracked';
let lastSearchResults = [];

// List update throttling (reduce hover animation resets)
let lastListUpdateTime = 0;
const listUpdateThrottleMs = 2000;

// Region definitions for quick search
const regions = {
    bosphorus: { minLat: 40.95, minLon: 28.95, maxLat: 41.25, maxLon: 29.15, name: 'Bosphorus' },
    marmara: { minLat: 40.4, minLon: 27.0, maxLat: 41.0, maxLon: 29.5, name: 'Marmara Sea' },
    aegean: { minLat: 36.5, minLon: 25.0, maxLat: 40.5, maxLon: 28.5, name: 'Aegean Sea' },
    mediterranean: { minLat: 35.5, minLon: 28.0, maxLat: 37.5, maxLon: 36.5, name: 'Eastern Mediterranean' }
};

// Rectangle drawing state
let isDrawingRectangle = false;
let rectangleStartPoint = null;
let isMouseDown = false;

// Performance: Lazy load and cache
const notesCache = new Map();

// ==================== DATABASE SYNC ====================

async function loadMyVesselsFromDatabase() {


    if (!authToken) {
        console.log('⚠️ Not logged in, skipping database load');
        return;
    }
    
    console.log('🔐 Token:', authToken.substring(0, 20) + '...');
    
    try {
        const response = await fetch('/api/vessels/my-vessels', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Server error:', response.status, errorText);
            throw new Error(`Failed to load vessels from database: ${response.status}`);
        }
        
        const vessels = await response.json();
        console.log(`✅ Loaded ${vessels.length} vessels from database:`, vessels);
        
        // Add to myVessels with proper structure
        vessels.forEach(vessel => {
            myVessels.set(vessel.mmsi, {
                id: vessel.id,
                mmsi: vessel.mmsi,
                name: vessel.name,
                imo: vessel.imo,
                callsign: vessel.callsign,
                ship_type: vessel.ship_type,
                added_at: vessel.added_at,
                // Ensure coordinates are numbers
                latitude: parseFloat(vessel.latitude || 0),
                longitude: parseFloat(vessel.longitude || 0)
            });
        });
        
        // Rebuild allVessels
        // Initially show ONLY my vessels if showAllVessels is false
        if (showAllVessels) {
            allVessels = new Map([...myVessels, ...aisVessels]);
        } else {
            allVessels = new Map([...myVessels]);
        }
        
        refreshMapWithFilters();
        
        console.log(`🗺️ ${myVessels.size} vessels loaded and displayed on map`);

    } catch (error) {
        console.error('Error loading vessels from database:', error);
    }
}


// ==================== FILTER SYSTEM ====================

function toggleFilter(filterType) {
    const button = document.querySelector(`.filter-chip[data-filter="${filterType}"]`);
    
    // All filters work as toggles (checkbox behavior)
    if (activeFilters.has(filterType)) {
        activeFilters.delete(filterType);
        button.classList.remove('active');
    } else {
        activeFilters.add(filterType);
        button.classList.add('active');
    }
    
    // Debounced filter application
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
        applyFilters();
    }, 150);
}

function applyFilters(silent = false) {
    if (activeFilters.size === 0) {
        // No filters - update GeoJSON with all vessels
        const allVesselsArray = Array.from(allVessels.values());
        
        // DEBUG: Check vessel categories
        const categoryCounts = { Tanker: 0, Cargo: 0, Container: 0, Other: 0, NoCategory: 0 };
        allVesselsArray.forEach(v => {
            const cat = getVesselCategory(v);
            if (cat) categoryCounts[cat]++;
            else categoryCounts.NoCategory++;
        });
        console.log('🔍 ALL VESSELS BREAKDOWN:', categoryCounts, 'Total:', allVesselsArray.length);
        
        updateVesselsOnMap(allVesselsArray);
        maybeUpdateVesselList(true);
        updateVesselCount(allVessels.size);
        return;
    }
    
    // Filter vessels
    const allVesselsArray = Array.from(allVessels.values());
    
    // Debug: Show what we're filtering
    console.log('🔍 Filtering', allVesselsArray.length, 'vessels with filters:', Array.from(activeFilters));
    
    // Separate filters into status and type categories
    const statusFilters = new Set();
    const typeFilters = new Set();
    
    for (const filter of activeFilters) {
        if (['moving', 'ballast', 'anchored', 'stationary'].includes(filter)) {
            statusFilters.add(filter);
        } else if (['tanker', 'container', 'cargo', 'other'].includes(filter)) {
            typeFilters.add(filter);
        }
    }
    
    // If all 4 status filters are selected, treat it as "no status filter"
    const allStatusSelected = statusFilters.size === 4 && 
                            statusFilters.has('moving') && 
                            statusFilters.has('anchored') && 
                            statusFilters.has('stationary') && 
                            statusFilters.has('ballast');
    
    // If all 4 vessel types are selected, treat it as "no type filter"
    const allTypesSelected = typeFilters.size === 4 && 
                            typeFilters.has('tanker') && 
                            typeFilters.has('container') && 
                            typeFilters.has('cargo') && 
                            typeFilters.has('other');
    
    const filteredVessels = allVesselsArray.filter(vessel => {
        const category = getVesselCategory(vessel);
        
        // Check status filters (OR within category) - but skip if all status selected
        if (statusFilters.size > 0 && !allStatusSelected) {
            let matchesStatus = false;
            for (const filter of statusFilters) {
                if (filter === 'moving' && !vessel.is_ballast && !vessel.is_anchored && !vessel.is_stationary) matchesStatus = true;
                if (filter === 'ballast' && vessel.is_ballast) matchesStatus = true;
                if (filter === 'anchored' && vessel.is_anchored) matchesStatus = true;
                if (filter === 'stationary' && vessel.is_stationary) matchesStatus = true;
            }
            if (!matchesStatus) return false;
        }
        
        // Check type filters (OR within category) - but skip if all types selected
        if (typeFilters.size > 0 && !allTypesSelected) {
            let matchesType = false;
            for (const filter of typeFilters) {
                if (filter === 'tanker' && category === 'Tanker') matchesType = true;
                if (filter === 'container' && category === 'Container') matchesType = true;
                if (filter === 'cargo' && category === 'Cargo') matchesType = true;
                if (filter === 'other' && category === 'Other') matchesType = true;
            }
            if (!matchesType) return false;
        }
        
        return true;
    });
    
    // DEBUG: Check filtered vessel categories
    const categoryCounts = { Tanker: 0, Cargo: 0, Container: 0, Other: 0 };
    filteredVessels.forEach(v => {
        const cat = getVesselCategory(v);
        categoryCounts[cat]++;
    });
    console.log('🔍 FILTERED VESSELS:', categoryCounts, 'Total:', filteredVessels.length, 'Active filters:', Array.from(activeFilters));
    
    // Update map with filtered vessels
    updateVesselsOnMap(filteredVessels);
    if (!silent) {
        showToast(`${filteredVessels.length} vessel${filteredVessels.length !== 1 ? 's' : ''} match filters`, 'success', 2000);
    }
    // Keep tracked list unchanged (filters only affect map)
    maybeUpdateVesselList(true);
    updateVesselCount(filteredVessels.length);
}

function isWithinBounds(vessel, bounds) {
    if (!bounds) return true;
    return vessel.latitude >= bounds.minLat &&
           vessel.latitude <= bounds.maxLat &&
           vessel.longitude >= bounds.minLon &&
           vessel.longitude <= bounds.maxLon;
}

function updateViewportBounds(bounds) {
    currentViewportBounds = bounds;

    if (!bounds || aisVessels.size === 0) return;

    let removed = 0;
    for (const [mmsi, vessel] of aisVessels) {
        if (!isWithinBounds(vessel, bounds)) {
            aisVessels.delete(mmsi);
            removed += 1;
        }
    }

    if (removed > 0 && showAllVessels) {
        allVessels = new Map([...myVessels, ...aisVessels]);
        refreshMapWithFilters();
    }
}

function getVesselCategory(vessel) {
    // First check ship_category from backend
    const backendCategory = vessel.ship_category;
    
    // Only accept Tanker, Cargo, Container as specific categories
    // Everything else (Pilot, Fishing, Passenger, etc.) goes to "Other"
    if (backendCategory === 'Tanker' || backendCategory === 'Cargo' || backendCategory === 'Container') {
        return backendCategory;
    }
    
    // Fallback: check ship_type string for manual categorization
    const type = (vessel.ship_type || '').toLowerCase();
    if (!type) return 'Other';

    if (type.includes('tanker') || type.includes('oil') || type.includes('lng') || type.includes('lpg')) {
        return 'Tanker';
    }
    if (type.includes('container')) {
        return 'Container';
    }
    if (type.includes('cargo') || type.includes('bulk') || type.includes('general')) {
        return 'Cargo';
    }

    // Everything else: Pilot, Fishing, Passenger, Tug, SAR, etc. → Other
    return 'Other';
}

function refreshMapWithFilters() {
    if (activeFilters.size > 0) {
        applyFilters(true);
        return;
    }

    const allVesselsArray = Array.from(allVessels.values());
    updateVesselsOnMap(allVesselsArray);
    maybeUpdateVesselList();
    updateVesselCount(allVessels.size);
}

// ==================== TOAST NOTIFICATIONS ====================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    
    // Icons
    const icons = {
        success: '✅',
        error: '',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Error toasts don't need icon emoji, they have visual indicators
    if (type === 'error') {
        toast.innerHTML = `
            <span class="toast-message">${escapeHtml(message)}</span>
        `;
    } else {
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || ''}</span>
            <span class="toast-message">${escapeHtml(message)}</span>
        `;
    }
    
    // Add to container
    container.appendChild(toast);
    
    // Auto remove after duration
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// TEST: Add dummy vessel on page load
function addTestVessel() {
    const testVessel = {
        mmsi: "123456789",
        name: "Test Gemi - Marmara Star",
        callsign: "TSTAR",
        latitude: 41.0082,
        longitude: 28.9784,
        speed: 12.5,
        heading: 45,
        ship_type: "Cargo Ship",
        destination: "Istanbul Port",
        status: "Underway"
    };
    
    console.log("📍 Test vessel added:", testVessel);
    addVesselMarker(testVessel);
    allVessels.set(testVessel.mmsi, testVessel);
    updateVesselList([testVessel]);
    updateVesselCount(1);
}

// Test vessel disabled - users should add vessels manually
// setTimeout(() => {
//     if (map) {
//         addTestVessel();
//     }
// }, 2000);

async function searchVessels() {
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput.value.trim();

    if (isDrawingRectangle) {
        toggleDrawRectangle();
    }

    if (!searchTerm) {
        showToast('Please enter a ship name or MMSI', 'warning');
        return;
    }

    try {
        let vessel = null;
        
        // Check if it's a number (MMSI) or text (name)
        if (/^\d+$/.test(searchTerm)) {
            // It's a number - search by MMSI (try both string and all vessels)
            vessel = aisVessels.get(searchTerm) || myVessels.get(searchTerm);
            
            // If not found, search through all vessels (in case MMSI is stored differently)
            if (!vessel) {
                const allSearchableVessels = new Map([...myVessels, ...aisVessels]);
                vessel = Array.from(allSearchableVessels.values()).find(v => 
                    v.mmsi === searchTerm || v.mmsi === parseInt(searchTerm) || String(v.mmsi) === searchTerm
                );
            }
            
            if (vessel) {
                console.log('✅ Found vessel by MMSI:', vessel);
            }
        } else {
            // It's text - search by name (partial match, case insensitive)
            const searchLower = searchTerm.toLowerCase();
            
            // Search in both aisVessels and myVessels
            const allSearchableVessels = new Map([...myVessels, ...aisVessels]);
            const found = Array.from(allSearchableVessels.values()).find(v => 
                v.name && v.name.toLowerCase().includes(searchLower)
            );
            
            if (found) {
                vessel = found;
                console.log('✅ Found vessel by name:', vessel);
            }
        }
        
        if (!vessel) {
            showToast(`Vessel "${searchTerm}" not found. Try different search terms or wait for more AIS data.`, 'warning');
            return;
        }
        
        // Zoom to vessel
        if (map) {
            map.flyTo({
                center: [vessel.longitude, vessel.latitude],
                zoom: 12,
                duration: 2000
            });
            
            // Show popup on map (like clicking the vessel)
            setTimeout(() => {
                const popupContent = `
                    <div class="vessel-popup">
                        <h3>🚢 ${vessel.name || 'Unknown Vessel'}</h3>
                        <div class="popup-details">
                            <p><strong>MMSI</strong><span>${vessel.mmsi}</span></p>
                            ${vessel.imo ? `<p><strong>IMO</strong><span>${vessel.imo}</span></p>` : ''}
                            ${vessel.callsign ? `<p><strong>Call Sign</strong><span>${vessel.callsign}</span></p>` : ''}
                            <p><strong>Type</strong><span>${vessel.ship_type || vessel.ship_category || 'Unknown'}</span></p>
                            ${vessel.destination ? `<p><strong>Destination</strong><span>${vessel.destination}</span></p>` : ''}
                            <p><strong>Speed</strong><span>${vessel.speed || 0} kts</span></p>
                            <p><strong>Course</strong><span>${vessel.course || 0}°</span></p>
                            ${vessel.eta ? `<p><strong>ETA</strong><span>${vessel.eta}</span></p>` : ''}
                        </div>
                    </div>
                `;
                
                new maplibregl.Popup()
                    .setLngLat([vessel.longitude, vessel.latitude])
                    .setHTML(popupContent)
                    .addTo(map);
            }, 1100); // Popup opens 1.1 seconds after zoom starts
        }
        
        showToast(`Found: ${vessel.name}`, 'success');
        
        // Clear search input
        searchInput.value = '';
        
    } catch (error) {
        console.error('Search error:', error);
        showToast('Error searching vessels', 'error');
    }
}

async function filterByBbox() {
    const minLat = parseFloat(document.getElementById('bbox-min-lat').value);
    const minLon = parseFloat(document.getElementById('bbox-min-lon').value);
    const maxLat = parseFloat(document.getElementById('bbox-max-lat').value);
    const maxLon = parseFloat(document.getElementById('bbox-max-lon').value);

    if (isNaN(minLat) || isNaN(minLon) || isNaN(maxLat) || isNaN(maxLon)) {
        showToast('Please enter all bounding box coordinates', 'warning');
        return;
    }

    if (minLat > maxLat || minLon > maxLon) {
        showToast('Invalid bounding box coordinates', 'warning');
        return;
    }

    try {
        const url = `/api/vessels/bbox?min_lat=${minLat}&min_lon=${minLon}&max_lat=${maxLat}&max_lon=${maxLon}`;
        const response = await fetch(url);

        if (!response.ok) throw new Error('Fetch failed');

        const vessels = await response.json();
        console.log(`Found ${vessels.length} vessels in bbox`);

        // Add to aisVessels (live pool) NOT myVessels
        vessels.forEach(vessel => {
            aisVessels.set(vessel.mmsi, vessel);
        });
        
        // Update map if showing all vessels
        if (showAllVessels) {
            allVessels = new Map([...myVessels, ...aisVessels]);
            refreshMapWithFilters();
            
            // Fit map to bbox
            if (map) {
                map.fitBounds([
                    [minLon, minLat],
                    [maxLon, maxLat]
                ], { padding: 50 });
            }
        } else {
            showToast(`Found ${vessels.length} vessels. Switch to 'All Vessels' to see them.`, 'info');
        }

        updateSearchResultsList(vessels);

        // Send WebSocket subscription
        if (wsConnected) {
            const message = {
                type: 'subscribe',
                bbox: `${minLat},${minLon},${maxLat},${maxLon}`
            };
            ws.send(JSON.stringify(message));
        }
    } catch (error) {
        console.error('Filter error:', error);
        showToast('Error fetching vessels', 'error');
    }
}


function updateVesselList(vessels) {
    const list = document.getElementById('vessel-list');
    
    console.log(`📋 updateVesselList called. showAllVessels=${showAllVessels}, myVessels.size=${myVessels.size}, aisVessels.size=${aisVessels.size}, allVessels.size=${allVessels.size}`);
    
    // Sidebar ALWAYS shows only tracked vessels (myVessels), regardless of toggle
    // The map respects the toggle, but sidebar is dedicated to tracked vessels
    let vesselsToShow = vessels;
    if (!vessels) {
        vesselsToShow = Array.from(myVessels.values());
        console.log(`✅ Showing myVessels only in sidebar: ${vesselsToShow.length} vessels`);
        
        // Apply active filters
        if (activeFilters.size > 0) {
            vesselsToShow = vesselsToShow.filter(vessel => {
                // Check if vessel passes all active filters
                for (const filter of activeFilters) {
                    if (filter === 'ballast' && !vessel.is_ballast) return false;
                    if (filter === 'anchored' && !vessel.is_anchored) return false;
                    if (filter === 'stationary' && !vessel.is_stationary) return false;
                    if (filter === 'tanker' && vessel.ship_category !== 'Tanker') return false;
                    if (filter === 'container' && vessel.ship_category !== 'Container') return false;
                    if (filter === 'cargo' && vessel.ship_category !== 'Cargo') return false;
                }
                return true;
            });
        }
    }

    if (vesselsToShow.length === 0) {
        list.innerHTML = '<li style="color: #999; text-align: center; padding: 2rem 0;">No vessels found</li>';
        return;
    }

    list.innerHTML = renderVesselListItems(vesselsToShow);
    if (currentListView === 'tracked') {
        applyListFilter();
    }
}

function renderVesselListItems(vessels) {
    return vessels.map(vessel => {
        // Status badges with better icons
        let badges = '';
        if (vessel.is_ballast) badges += '<span style="background:#dc3545;color:white;padding:0.25rem 0.5rem;border-radius:12px;font-size:0.7rem;margin-right:0.35rem;font-weight:600;display:inline-flex;align-items:center;gap:0.25rem;">⚖️ BALLAST</span>';
        if (vessel.is_anchored) badges += '<span style="background:#6c757d;color:white;padding:0.25rem 0.5rem;border-radius:12px;font-size:0.7rem;margin-right:0.35rem;font-weight:600;display:inline-flex;align-items:center;gap:0.25rem;">⚓ ANCHORED</span>';
        if (vessel.is_stationary) badges += '<span style="background:#ffc107;color:#333;padding:0.25rem 0.5rem;border-radius:12px;font-size:0.7rem;margin-right:0.35rem;font-weight:600;display:inline-flex;align-items:center;gap:0.25rem;">⏸️ STATIONARY</span>';
        if (!vessel.is_ballast && !vessel.is_anchored && !vessel.is_stationary) {
            badges += '<span style="background:#2ea043;color:white;padding:0.25rem 0.5rem;border-radius:12px;font-size:0.7rem;margin-right:0.35rem;font-weight:600;display:inline-flex;align-items:center;gap:0.25rem;">🟢 MOVING</span>';
        }
        
        // Ship type badge
        let typeIcon = '🚢';
        let typeName = 'Other';
        let typeColor = '#6c757d';
        if (vessel.ship_category === 'Tanker') {
            typeIcon = '🛢️';
            typeName = 'Tanker';
            typeColor = '#4a90e2';
        } else if (vessel.ship_category === 'Container') {
            typeIcon = '📦';
            typeName = 'Container';
            typeColor = '#ff6b6b';
        } else if (vessel.ship_category === 'Cargo') {
            typeIcon = '🚢';
            typeName = 'Cargo';
            typeColor = '#2ecc71';
        } else {
            typeIcon = '🚤';
            typeName = 'Other';
            typeColor = '#6c757d';
        }
        
        badges += `<span style="background:${typeColor};color:white;padding:0.25rem 0.5rem;border-radius:12px;font-size:0.7rem;margin-right:0.35rem;font-weight:600;display:inline-flex;align-items:center;gap:0.25rem;">${typeIcon} ${typeName.toUpperCase()}</span>`;
        
        // Check if this vessel is in myVessels (tracked)
        const isTracked = myVessels.has(vessel.mmsi) || myVessels.has(String(vessel.mmsi));
        
        // Only show action buttons for tracked vessels
        const actionButtons = isTracked ? `
            <div class="vessel-actions">
                <button class="btn-action btn-info" onclick="openInfoModal('${vessel.mmsi}'); event.stopPropagation();" title="View info & notes">
                    <i class="fas fa-info-circle"></i>
                </button>
                <button class="btn-action btn-note" onclick="openNoteModal('${vessel.mmsi}'); event.stopPropagation();" title="Add note">
                    <i class="fas fa-plus"></i>
                </button>
                <button class="btn-action btn-delete" onclick="confirmRemoveVessel('${vessel.mmsi}'); event.stopPropagation();" title="Remove vessel">
                    <i class="fas fa-trash"></i>
                </button>
            </div>` : '';
        
        return `
        <li class="vessel-item" onclick="selectVessel('${vessel.mmsi}', this)">
            <div style="cursor: pointer; flex: 1; min-width: 0;">
                <div class="vessel-name" style="margin-bottom: 0.5rem;">${vessel.name}${isTracked ? ' <span style="color:#2ea043;font-size:0.8rem;">★</span>' : ''}</div>
                <div style="margin-bottom: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.25rem;">${badges}</div>
                <div class="vessel-info">
                    <span>MMSI: ${vessel.mmsi}</span>
                    <span class="vessel-speed">${vessel.speed || 0} kts</span>
                </div>
                <div class="vessel-info">
                    <span>${vessel.latitude.toFixed(4)}°N</span>
                    <span>${vessel.longitude.toFixed(4)}°E</span>
                </div>
            </div>
            ${actionButtons}
        </li>
    `;
    }).join('');
}

function filterVesselsByQuery(vessels, query) {
    if (!query) return vessels;
    const q = query.toLowerCase();
    return vessels.filter(vessel => {
        const name = (vessel.name || '').toLowerCase();
        const mmsi = String(vessel.mmsi || '').toLowerCase();
        const callsign = (vessel.callsign || '').toLowerCase();
        const imo = String(vessel.imo || '').toLowerCase();
        const type = (vessel.ship_type || vessel.ship_category || '').toLowerCase();
        return name.includes(q) || mmsi.includes(q) || callsign.includes(q) || imo.includes(q) || type.includes(q);
    });
}

function dedupeVesselsByMmsi(vessels) {
    const seen = new Set();
    return vessels.filter(vessel => {
        const key = String(vessel?.mmsi ?? '').trim();
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function filterByActiveFilters(vessels) {
    if (activeFilters.size === 0) return vessels;

    const statusFilters = new Set();
    const typeFilters = new Set();

    for (const filter of activeFilters) {
        if (['moving', 'ballast', 'anchored', 'stationary'].includes(filter)) {
            statusFilters.add(filter);
        } else if (['tanker', 'container', 'cargo', 'other'].includes(filter)) {
            typeFilters.add(filter);
        }
    }

    const allStatusSelected = statusFilters.size === 4 &&
                            statusFilters.has('moving') &&
                            statusFilters.has('anchored') &&
                            statusFilters.has('stationary') &&
                            statusFilters.has('ballast');

    const allTypesSelected = typeFilters.size === 4 &&
                            typeFilters.has('tanker') &&
                            typeFilters.has('container') &&
                            typeFilters.has('cargo') &&
                            typeFilters.has('other');

    return vessels.filter(vessel => {
        const category = getVesselCategory(vessel);

        if (statusFilters.size > 0 && !allStatusSelected) {
            let matchesStatus = false;
            for (const filter of statusFilters) {
                if (filter === 'moving' && !vessel.is_ballast && !vessel.is_anchored && !vessel.is_stationary) matchesStatus = true;
                if (filter === 'ballast' && vessel.is_ballast) matchesStatus = true;
                if (filter === 'anchored' && vessel.is_anchored) matchesStatus = true;
                if (filter === 'stationary' && vessel.is_stationary) matchesStatus = true;
            }
            if (!matchesStatus) return false;
        }

        if (typeFilters.size > 0 && !allTypesSelected) {
            let matchesType = false;
            for (const filter of typeFilters) {
                if (filter === 'tanker' && category === 'Tanker') matchesType = true;
                if (filter === 'container' && category === 'Container') matchesType = true;
                if (filter === 'cargo' && category === 'Cargo') matchesType = true;
                if (filter === 'other' && category === 'Other') matchesType = true;
            }
            if (!matchesType) return false;
        }

        return true;
    });
}

function updateSearchResultsList(vessels) {
    const list = document.getElementById('search-results-list');
    const title = document.getElementById('search-results-title');
    if (!list) return;

    lastSearchResults = Array.isArray(vessels) ? dedupeVesselsByMmsi(vessels) : [];
    const input = document.getElementById('list-filter-input');
    const query = (input?.value || '').trim();
    const results = currentListView === 'search' ? filterVesselsByQuery(lastSearchResults, query) : lastSearchResults;
    if (results.length === 0) {
        list.innerHTML = '<li style="color: #8b949e; text-align: center; padding: 2rem 0;">No Search Results</li>';
        if (title) title.innerHTML = '<i class="fas fa-search"></i> Search Results';
        return;
    }

    if (title) title.innerHTML = `<i class="fas fa-search"></i> Search Results (${results.length})`;
    list.innerHTML = renderVesselListItems(results);
}

function clearSearchResults() {
    updateSearchResultsList([]);
}

function showListView(view) {
    currentListView = view === 'search' ? 'search' : 'tracked';
    const trackedSection = document.getElementById('tracked-section');
    const searchSection = document.getElementById('search-results-section');
    const trackedBtn = document.getElementById('list-toggle-tracked');
    const searchBtn = document.getElementById('list-toggle-search');

    if (trackedSection) trackedSection.style.display = currentListView === 'tracked' ? 'block' : 'none';
    if (searchSection) searchSection.style.display = currentListView === 'search' ? 'block' : 'none';

    if (trackedBtn) trackedBtn.classList.toggle('active', currentListView === 'tracked');
    if (searchBtn) searchBtn.classList.toggle('active', currentListView === 'search');

    applyListFilter();
}

function applyListFilter() {
    const input = document.getElementById('list-filter-input');
    const query = (input?.value || '').trim();

    if (currentListView === 'tracked') {
        const list = document.getElementById('vessel-list');
        if (!list) return;
        let data = Array.from(myVessels.values());
        data = filterVesselsByQuery(data, query);
        list.innerHTML = data.length
            ? renderVesselListItems(data)
            : '<li style="color: #999; text-align: center; padding: 2rem 0;">No tracked vessels match</li>';
        return;
    }

    const list = document.getElementById('search-results-list');
    if (!list) return;
    const data = filterVesselsByQuery(lastSearchResults, query);
    list.innerHTML = data.length
        ? renderVesselListItems(data)
        : '<li style="color: #8b949e; text-align: center; padding: 2rem 0;">No search results match</li>';
}

function maybeUpdateVesselList(force = false, vessels = undefined) {
    const now = Date.now();
    if (!force && now - lastListUpdateTime < listUpdateThrottleMs) {
        return;
    }
    lastListUpdateTime = now;
    updateVesselList(vessels);
}

function selectVessel(mmsi, vesselElement) {
    // Update UI
    document.querySelectorAll('.vessel-item').forEach(el => {
        el.classList.remove('selected');
    });
    if (vesselElement) {
        vesselElement.classList.add('selected');
    }

    // Show info
    const numericMmsi = Number(mmsi);
    const vessel = allVessels.get(numericMmsi) || allVessels.get(mmsi);
    if (vessel) {
        showVesselInfo(vessel);
        
        // Zoom harita to vessel location
        const lat = Number(vessel.latitude);
        const lon = Number(vessel.longitude);
        if (map && Number.isFinite(lat) && Number.isFinite(lon)) {
            map.flyTo({
                center: [lon, lat],
                zoom: 11,
                duration: 1500,
                essential: true
            });
            
            // Highlight vessel on map
            if (map.getLayer('vessel-points')) {
                map.setFilter('vessel-points', ['==', ['get', 'mmsi'], numericMmsi]);
            }
        }
    }
}

async function addVesselByMMSI() {
    const mmsiInput = document.getElementById('mmsi-input');
    const searchTerm = mmsiInput.value.trim();
    const button = document.querySelector('#mmsi-input + button');

    if (!searchTerm) {
        showToast('Please enter vessel name or MMSI', 'warning');
        return;
    }

    try {
        // Show loading state
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';
        button.disabled = true;

        // Search vessel in memory (aisVessels, myVessels)
        let vessel = null;
        
        // Try exact match first
        if (aisVessels.has(searchTerm)) {
            vessel = aisVessels.get(searchTerm);
        } else if (aisVessels.has(parseInt(searchTerm))) {
            vessel = aisVessels.get(parseInt(searchTerm));
        } else if (myVessels.has(searchTerm)) {
            vessel = myVessels.get(searchTerm);
        } else if (myVessels.has(parseInt(searchTerm))) {
            vessel = myVessels.get(parseInt(searchTerm));
        } else {
            // Search by MMSI or name
            const allSearchableVessels = new Map([...myVessels, ...aisVessels]);
            vessel = Array.from(allSearchableVessels.values()).find(v =>
                String(v.mmsi) === searchTerm ||
                v.mmsi === parseInt(searchTerm) ||
                (v.name && v.name.toLowerCase().includes(searchTerm.toLowerCase()))
            );
        }

        if (!vessel) {
            showToast('Vessel not found. Try searching by MMSI or name.', 'warning');
            button.innerHTML = '<i class="fas fa-plus"></i> Add Vessel';
            button.disabled = false;
            return;
        }

        // Validate MMSI
        const mmsiStr = String(vessel.mmsi || searchTerm).trim();
        if (!/^[0-9]{9}$/.test(mmsiStr)) {
            showToast('MMSI must be exactly 9 digits', 'error');
            button.innerHTML = '<i class="fas fa-plus"></i> Add Vessel';
            button.disabled = false;
            return;
        }

        // Check if already tracked
        if (myVessels.has(mmsiStr) || myVessels.has(parseInt(mmsiStr))) {
            showToast('Vessel already in tracked list', 'info');
            button.innerHTML = '<i class="fas fa-plus"></i> Add Vessel';
            button.disabled = false;
            return;
        }

        // Validate coordinates
        const latitude = parseFloat(vessel.latitude ?? vessel.lat ?? 0);
        const longitude = parseFloat(vessel.longitude ?? vessel.lon ?? 0);

        if (isNaN(latitude) || isNaN(longitude)) {
            showToast('Vessel coordinates are invalid', 'error');
            button.innerHTML = '<i class="fas fa-plus"></i> Add Vessel';
            button.disabled = false;
            return;
        }

        // Save to database if logged in
        if (authToken) {
            try {
                const response = await fetch('/api/vessels/track', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({
                        mmsi: mmsiStr,
                        name: vessel.name || null,
                        imo: vessel.imo || null,
                        callsign: vessel.callsign || null,
                        ship_type: vessel.ship_type || null,
                        latitude: latitude,
                        longitude: longitude
                    })
                });

                if (!response.ok) {
                    const error = await response.json();
                    const errorMsg = typeof error.detail === 'string' 
                        ? error.detail 
                        : 'Failed to save vessel';
                    showToast(`Error: ${errorMsg}`, 'error');
                    button.innerHTML = '<i class="fas fa-plus"></i> Add Vessel';
                    button.disabled = false;
                    return;
                }

                const savedVessel = await response.json();
                vessel.id = savedVessel.id;
                showToast('✅ Vessel added successfully!', 'success');
            } catch (error) {
                console.error('Database save error:', error);
                showToast(`Error: ${error.message}`, 'error');
                button.innerHTML = '<i class="fas fa-plus"></i> Add Vessel';
                button.disabled = false;
                return;
            }
        }

        // Add to myVessels
        console.log(`🔴 ADDING VESSEL TO myVessels: MMSI=${mmsiStr}, name=${vessel.name}`);
        console.trace('Stack trace:');
        myVessels.set(mmsiStr, vessel);

        // Rebuild allVessels
        if (showAllVessels) {
            allVessels = new Map([...myVessels, ...aisVessels]);
        } else {
            allVessels = new Map([...myVessels]);
        }
        
        refreshMapWithFilters();

        // Clear input and restore button
        mmsiInput.value = '';
        button.innerHTML = '<i class="fas fa-plus"></i> Add Vessel';
        button.disabled = false;

        console.log(`✅ Vessel ${vessel.name || mmsiStr} added to tracking`);
    } catch (error) {
        console.error('Error in addVesselByMMSI:', error);
        showToast('An error occurred', 'error');
        button.innerHTML = '<i class="fas fa-plus"></i> Add Vessel';
        button.disabled = false;
    }
}

async function confirmRemoveVessel(mmsi) {
    const mmsiStr = String(mmsi || '').trim();
    if (!mmsiStr) return;

    const vessel = myVessels.get(mmsiStr) || myVessels.get(parseInt(mmsiStr));

    const vesselLabel = vessel?.name ? `${vessel.name} (${mmsiStr})` : mmsiStr;
    const confirmed = confirm(`Remove tracked vessel ${vesselLabel}?`);
    if (!confirmed) return;

    // Remove from DB if logged in (delete by MMSI)
    if (authToken) {
        try {
            const response = await fetch(`/api/vessels/track/mmsi/${mmsiStr}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (!response.ok) {
                // Fallback: try delete by ID if available
                if (vessel?.id) {
                    const fallback = await fetch(`/api/vessels/track/${vessel.id}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${authToken}`
                        }
                    });

                    if (!fallback.ok) {
                        const errorText = await fallback.text();
                        console.error('❌ Failed to delete vessel:', fallback.status, errorText);
                        showToast('Failed to remove vessel from database', 'error');
                        return;
                    }
                } else {
                    const errorText = await response.text();
                    console.error('❌ Failed to delete vessel:', response.status, errorText);
                    showToast('Failed to remove vessel from database', 'error');
                    return;
                }
            }
        } catch (error) {
            console.error('❌ Delete request failed:', error);
            showToast('Failed to remove vessel from database', 'error');
            return;
        }
    }

    // Remove locally
    myVessels.delete(mmsiStr);
    myVessels.delete(parseInt(mmsiStr));
    allVessels.delete(mmsiStr);
    allVessels.delete(parseInt(mmsiStr));

    refreshMapWithFilters();
    updateVesselList();
    showToast('Vessel removed from tracked list', 'success');
}

// Alias for confirmRemoveVessel
function confirmDeleteVessel(mmsi) {
    return confirmRemoveVessel(mmsi);
}

// ==================== NOTES SYSTEM ====================

let currentVesselMMSI = null;

function showVesselInfo(mmsi) {
    const vessel = allVessels.get(mmsi);
    if (!vessel) return;

    currentVesselMMSI = mmsi.toString();
    window.currentVesselMMSI = mmsi.toString();

    // Harita üzerindeki info panelini doldur
    document.getElementById('info-name').textContent = vessel.name || 'Unknown';
    document.getElementById('info-mmsi').textContent = vessel.mmsi || '--';
    document.getElementById('info-callsign').textContent = vessel.callsign || '--';
    document.getElementById('info-speed').textContent = `${vessel.speed || 0} knots`;
    document.getElementById('info-heading').textContent = `${vessel.heading || 0}°`;
    document.getElementById('info-destination').textContent = vessel.destination || '--';
    document.getElementById('info-type').textContent = vessel.ship_type || vessel.ship_category || '--';

    // ETA hesapla (eğer destination varsa)
    const etaContainer = document.getElementById('info-eta');
    if (vessel.destination && vessel.destination !== '--' && vessel.speed > 0) {
        const destCoords = getDestinationCoords(vessel.destination);
        if (destCoords) {
            const distance = calculateDistance(
                vessel.latitude, vessel.longitude,
                destCoords.lat, destCoords.lon
            );
            const eta = calculateETA(distance, vessel.speed);
            
            if (eta) {
                etaContainer.innerHTML = `
                    <div style="background: #f0f9ff; padding: 0.8rem; border-radius: 6px; border-left: 3px solid #0066cc; font-size: 0.85rem;">
                        <div style="margin-bottom: 0.4rem;"><strong>📍 Distance:</strong> ${distance.toFixed(1)} nm</div>
                        <div><strong>⏰ ETA:</strong> ${eta.hours}h ${eta.minutes}m<br><small>(${eta.arrivalTime})</small></div>
                    </div>
                `;
            } else {
                etaContainer.innerHTML = '';
            }
        } else {
            etaContainer.innerHTML = '';
        }
    } else {
        etaContainer.innerHTML = '';
    }

    // Paneli göster
    document.getElementById('vessel-info').style.display = 'block';
}

function closeVesselInfo() {
    document.getElementById('vessel-info').style.display = 'none';
    window.currentVesselMMSI = null;
}

function displayVesselNotes(mmsi) {
    const notes = loadVesselNotes(mmsi);
    const notesContainer = document.getElementById('modal-notes-list');

    if (notes.length === 0) {
        notesContainer.innerHTML = `
            <div style="text-align: center; padding: 2rem; background: rgba(22, 27, 34, 0.4); border-radius: 8px; border: 1px dashed rgba(48, 54, 61, 0.5);">
                <div style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.5;">📝</div>
                <div style="color: #8b949e; font-size: 0.9rem;">No notes yet</div>
            </div>
        `;
        return;
    }

    const notesHTML = notes.map((note, index) => {
        // Parse and format date better
        const noteDate = new Date(note.date);
        const formattedDate = noteDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        return `
        <div class="note-item" style="
            background: rgba(22, 27, 34, 0.6);
            border: 1px solid rgba(48, 54, 61, 0.5);
            border-radius: 10px;
            padding: 1rem;
            margin-bottom: 0.75rem;
            transition: all 0.2s;
            display: flex;
            gap: 1rem;
            align-items: start;
        " onmouseover="this.style.background='rgba(22, 27, 34, 0.9)'; this.style.borderColor='rgba(88, 166, 255, 0.3)'" onmouseout="this.style.background='rgba(22, 27, 34, 0.6)'; this.style.borderColor='rgba(48, 54, 61, 0.5)'">
            <div style="flex: 1; min-width: 0;">
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    margin-bottom: 0.5rem;
                    color: #8b949e;
                    font-size: 0.75rem;
                    font-weight: 600;
                ">
                    <span style="color: #58a6ff;">✏️</span>
                    <span>${formattedDate}</span>
                </div>
                <div style="
                    color: #e6edf3;
                    line-height: 1.6;
                    word-wrap: break-word;
                    font-size: 0.9rem;
                ">${escapeHtml(note.text)}</div>
            </div>
            <button onclick="deleteNote('${mmsi}', ${index}); event.stopPropagation();" style="
                background: rgba(220, 53, 69, 0.1);
                border: 1px solid rgba(220, 53, 69, 0.3);
                color: #dc3545;
                cursor: pointer;
                padding: 0.5rem 0.6rem;
                font-size: 0.85rem;
                border-radius: 6px;
                transition: all 0.2s;
                flex-shrink: 0;
            " onmouseover="this.style.background='#dc3545'; this.style.color='white'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(220, 53, 69, 0.1)'; this.style.color='#dc3545'; this.style.transform='scale(1)'" title="Delete note">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `}).join('');

    notesContainer.innerHTML = notesHTML;
}

function deleteNote(mmsi, index) {
    const notes = loadVesselNotes(mmsi);
    notes.splice(index, 1); // Remove note at index
    saveVesselNotes(mmsi, notes);
    displayVesselNotes(mmsi);
    showToast('Note deleted', 'success');
}

function openNoteModal(mmsi) {
    currentVesselMMSI = mmsi;
    document.getElementById('note-text').value = '';
    document.getElementById('note-modal').style.display = 'flex';
}

function openInfoModal(mmsi) {
    // Search with both string and number keys
    let vessel = myVessels.get(mmsi) || 
                 myVessels.get(String(mmsi)) || 
                 myVessels.get(parseInt(mmsi)) ||
                 aisVessels.get(mmsi) || 
                 aisVessels.get(String(mmsi)) || 
                 aisVessels.get(parseInt(mmsi)) ||
                 allVessels.get(mmsi) ||
                 allVessels.get(String(mmsi)) ||
                 allVessels.get(parseInt(mmsi));
    
    // If still not found, search through values
    if (!vessel) {
        const allSearchableVessels = new Map([...myVessels, ...aisVessels, ...allVessels]);
        vessel = Array.from(allSearchableVessels.values()).find(v => 
            v.mmsi === mmsi || 
            v.mmsi === String(mmsi) || 
            v.mmsi === parseInt(mmsi) ||
            String(v.mmsi) === String(mmsi)
        );
    }
    
    if (!vessel) {
        showToast('Vessel not found', 'error');
        console.error('Could not find vessel with MMSI:', mmsi);
        console.log('Available vessels:', { 
            myVessels: Array.from(myVessels.keys()), 
            aisVessels: Array.from(aisVessels.keys()).slice(0, 10) 
        });
        return;
    }
    
    currentVesselMMSI = mmsi;
    
    // Update modal title
    document.getElementById('modal-title').textContent = vessel.name;
    
    // Populate vessel info
    let infoHTML = `
        <p><strong>MMSI:</strong> ${vessel.mmsi}</p>
        <p><strong>Call Sign:</strong> ${vessel.callsign || '--'}</p>
        <p><strong>Speed:</strong> ${vessel.speed || 0} kts</p>
        <p><strong>Course:</strong> ${vessel.course || vessel.heading || 0}°</p>
        <p><strong>Destination:</strong> ${vessel.destination || '--'}</p>
        <p><strong>Type:</strong> ${vessel.ship_type || '--'}</p>
    `;
    
    // Add ETA if available
    if (vessel.destination && vessel.destination !== '--' && vessel.speed > 0) {
        const destCoords = getDestinationCoords(vessel.destination);
        if (destCoords) {
            const distance = calculateDistance(vessel.latitude, vessel.longitude, destCoords.lat, destCoords.lon);
            const eta = calculateETA(distance, vessel.speed);
            infoHTML += `
                <p><strong>Distance:</strong> ${distance.toFixed(1)} nm</p>
                <p><strong>ETA:</strong> ${eta.hours}h ${eta.minutes}m (${eta.arrivalTime})</p>
            `;
        }
    }
    
    document.getElementById('modal-vessel-info').innerHTML = infoHTML;
    
    // Display notes
    displayVesselNotes(mmsi);
    
    // Show modal
    document.getElementById('info-modal').style.display = 'flex';
}

function saveNote() {
    if (!currentVesselMMSI) return;

    const noteText = document.getElementById('note-text').value.trim();
    if (!noteText) {
        showToast('Please enter a note', 'warning');
        return;
    }

    // Tarih oluştur
    const now = new Date();
    const date = now.toLocaleDateString('tr-TR') + ' ' + now.toLocaleTimeString('tr-TR').slice(0, 5);

    // LocalStorage'e kaydet
    const notes = loadVesselNotes(currentVesselMMSI);
    notes.push({ date, text: noteText });
    saveVesselNotes(currentVesselMMSI, notes);

    console.log(`✅ Note saved for vessel ${currentVesselMMSI}`);

    // Modali kapat ve bilgileri güncelle
    closeModal('note-modal');
    displayVesselNotes(currentVesselMMSI);

    showToast('Note saved successfully!', 'success');
}

function loadVesselNotes(mmsi) {
    const key = `vessel_${mmsi}_notes`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
}

function saveVesselNotes(mmsi, notes) {
    const key = `vessel_${mmsi}_notes`;
    localStorage.setItem(key, JSON.stringify(notes));
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Modali dışarıdan tıklanırsa kapat
window.onclick = function(event) {
    const infoModal = document.getElementById('info-modal');
    const noteModal = document.getElementById('note-modal');
    
    if (event.target === infoModal) infoModal.style.display = 'none';
    if (event.target === noteModal) noteModal.style.display = 'none';
}

// Export functions for use in other scripts
window.searchVessels = searchVessels;
window.filterByBbox = filterByBbox;
window.searchCurrentView = searchCurrentView;
window.quickRegion = quickRegion;
window.toggleDrawRectangle = toggleDrawRectangle;
window.selectVessel = selectVessel;
window.updateVesselList = updateVesselList;
window.addVesselByMMSI = addVesselByMMSI;
window.confirmRemoveVessel = confirmRemoveVessel;
window.confirmDeleteVessel = confirmDeleteVessel;
window.clearAllVessels = clearAllVessels;
window.showVesselInfo = showVesselInfo;
window.openNoteModal = openNoteModal;
window.openInfoModal = openInfoModal;
window.saveNote = saveNote;
window.closeModal = closeModal;
window.deleteNote = deleteNote;
window.closeVesselInfo = closeVesselInfo;
window.toggleVesselSource = toggleVesselSource;
window.showListView = showListView;
window.applyListFilter = applyListFilter;

// ==================== CLEAR ALL VESSELS ====================

async function clearAllVessels() {
    if (myVessels.size === 0) {
        showToast('No tracked vessels to clear', 'info');
        return;
    }
    
    const count = myVessels.size;
    const confirmed = confirm(`Are you sure you want to remove all ${count} tracked vessel${count !== 1 ? 's' : ''}?\n\nThis cannot be undone.`);
    
    if (!confirmed) return;
    
    // Remove all tracked vessels from DB if logged in
    if (authToken) {
        const vesselsToDelete = Array.from(myVessels.values());
        const deleteResults = await Promise.all(vesselsToDelete.map(async (vessel) => {
            const mmsiStr = String(vessel.mmsi || '').trim();
            try {
                const response = await fetch(`/api/vessels/track/mmsi/${mmsiStr}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${authToken}`
                    }
                });

                if (response.ok) return true;

                // Fallback: try delete by ID
                if (vessel?.id) {
                    const fallback = await fetch(`/api/vessels/track/${vessel.id}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${authToken}`
                        }
                    });
                    return fallback.ok;
                }

                return false;
            } catch (error) {
                console.error('❌ Bulk delete failed for MMSI:', mmsiStr, error);
                return false;
            }
        }));

        const failed = deleteResults.filter(r => !r).length;
        if (failed > 0) {
            showToast(`⚠️ ${failed} vessel${failed !== 1 ? 's' : ''} could not be removed from database`, 'warning');
        }
    }

    // Clear all tracked vessels locally
    myVessels.clear();
    
    // Rebuild allVessels (only AIS vessels remain)
    if (showAllVessels) {
        allVessels = new Map([...aisVessels]);
    } else {
        allVessels = new Map();
    }
    
    // Update map and list
    refreshMapWithFilters();

    
    // Clear the vessel list UI
    document.getElementById('vessel-list').innerHTML = `
        <li style="color: #999; text-align: center; padding: 2rem 0;">
            No vessels yet. Add one with ➕ button above.
        </li>
    `;
    
    showToast(`✅ Cleared ${count} tracked vessel${count !== 1 ? 's' : ''}`, 'success');
}

// ==================== AREA SEARCH FUNCTIONS ====================

async function searchCurrentView(options = {}) {
    const { silent = false } = options;
    if (!map) {
        if (!silent) {
            showToast('Map not initialized', 'error');
        }
        return;
    }
    
    const bounds = map.getBounds();
    const minLat = bounds.getSouth();
    const minLon = bounds.getWest();
    const maxLat = bounds.getNorth();
    const maxLon = bounds.getEast();
    
    searchInBoundingBox(minLat, minLon, maxLat, maxLon, 'current view', { silent });
}

async function quickRegion(regionKey) {
    console.log('🌍 quickRegion called with key:', regionKey);
    const region = regions[regionKey];
    if (!region) {
        console.error('❌ Region not found:', regionKey);
        return;
    }

    console.log('🔍 quickRegion data:', region);

    if (!map) {
        console.error('❌ Map not initialized');
        return;
    }
    
    // Fit map to region
    map.fitBounds([
        [region.minLon, region.minLat],
        [region.maxLon, region.maxLat]
    ], { padding: 50 });
    
    // Call search directly - will filter locally first, then hit API if needed
    await searchInBoundingBox(region.minLat, region.minLon, region.maxLat, region.maxLon, region.name);
}

function toggleDrawRectangle() {
    console.log('🎯 toggleDrawRectangle called, map exists:', !!map);
    if (!map) {
        showToast('Map not initialized', 'error');
        return;
    }
    isDrawingRectangle = !isDrawingRectangle;
    const btn = document.getElementById('draw-rectangle-btn');
    console.log('📐 Drawing mode:', isDrawingRectangle ? 'ENABLED' : 'DISABLED');
    
    if (isDrawingRectangle) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-times"></i> Cancel Drawing';
        map.getCanvas().style.cursor = 'crosshair';
        showToast('📐 Click and drag to select area', 'info', 3000);
        rectangleStartPoint = null;
        isMouseDown = false;
        enableRectangleDrawing();
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-vector-square"></i> Draw Search Area';
        map.getCanvas().style.cursor = '';
        rectangleStartPoint = null;
        isMouseDown = false;
        disableRectangleDrawing();
    }
}

function cancelDrawIfActive() {
    if (isDrawingRectangle) {
        toggleDrawRectangle();
    }
}

function enableRectangleDrawing() {
    // Add handlers directly to map container
    const mapCanvas = map.getCanvas();
    mapCanvas.addEventListener('mousedown', onRectangleMouseDown);
    mapCanvas.addEventListener('mousemove', onRectangleMouseMove);
    mapCanvas.addEventListener('mouseup', onRectangleMouseUp);
    mapCanvas.addEventListener('touchstart', onRectangleTouchStart, { passive: false });
    mapCanvas.addEventListener('touchmove', onRectangleTouchMove, { passive: false });
    mapCanvas.addEventListener('touchend', onRectangleTouchEnd, { passive: false });
}

function disableRectangleDrawing() {
    const mapCanvas = map.getCanvas();
    mapCanvas.removeEventListener('mousedown', onRectangleMouseDown);
    mapCanvas.removeEventListener('mousemove', onRectangleMouseMove);
    mapCanvas.removeEventListener('mouseup', onRectangleMouseUp);
    mapCanvas.removeEventListener('touchstart', onRectangleTouchStart, { passive: false });
    mapCanvas.removeEventListener('touchmove', onRectangleTouchMove, { passive: false });
    mapCanvas.removeEventListener('touchend', onRectangleTouchEnd, { passive: false });
    
    // Remove all rectangle layers if exist
    if (map.getLayer('search-rectangle-glow')) map.removeLayer('search-rectangle-glow');
    if (map.getLayer('search-rectangle')) map.removeLayer('search-rectangle');
    if (map.getLayer('search-rectangle-fill')) map.removeLayer('search-rectangle-fill');
    if (map.getSource('search-rectangle')) map.removeSource('search-rectangle');
}

function onRectangleTouchStart(e) {
    if (!isDrawingRectangle) return;
    e.preventDefault();
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    onRectangleMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
}

function onRectangleTouchMove(e) {
    if (!isDrawingRectangle) return;
    e.preventDefault();
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    onRectangleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function onRectangleTouchEnd(e) {
    if (!isDrawingRectangle) return;
    e.preventDefault();
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    onRectangleMouseUp({ clientX: touch.clientX, clientY: touch.clientY });
}

function ensureAllVesselsMode() {
    if (!showAllVessels) {
        showAllVessels = true;
        const toggle = document.getElementById('vessel-source-toggle');
        const statusText = document.getElementById('toggle-status');
        if (toggle && statusText) {
            toggle.classList.add('active');
            statusText.classList.add('active');
            statusText.textContent = 'All Vessels';
        }
    }
    if (!aisWebSocket || aisWebSocket.readyState !== WebSocket.OPEN) {
        connectToAISStream();
    }
}

function onRectangleMouseDown(e) {
    if (!isDrawingRectangle) return;
    
    // Get coordinates from canvas position
    const rect = map.getCanvas().getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert canvas position to lngLat
    const lngLat = map.unproject([x, y]);
    rectangleStartPoint = [lngLat.lng, lngLat.lat];
    isMouseDown = true;
    map.dragPan.disable(); // Disable map dragging while drawing
    
    console.log('Drawing started at:', rectangleStartPoint);
}

function onRectangleMouseUp(e) {
    if (!isDrawingRectangle || !isMouseDown || !rectangleStartPoint) return;
    
    // Get coordinates from canvas position
    const rect = map.getCanvas().getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert canvas position to lngLat
    const lngLat = map.unproject([x, y]);
    const endPoint = [lngLat.lng, lngLat.lat];
    
    isMouseDown = false;
    map.dragPan.enable(); // Re-enable map dragging
    
    const minLat = Math.min(rectangleStartPoint[1], endPoint[1]);
    const maxLat = Math.max(rectangleStartPoint[1], endPoint[1]);
    const minLon = Math.min(rectangleStartPoint[0], endPoint[0]);
    const maxLon = Math.max(rectangleStartPoint[0], endPoint[0]);
    
    // Check if area is too small (accidental click)
    if (Math.abs(maxLat - minLat) < 0.01 || Math.abs(maxLon - minLon) < 0.01) {
        showToast('Area too small. Try again.', 'warning', 2000);
        rectangleStartPoint = null;
        disableRectangleDrawing();
        setTimeout(() => enableRectangleDrawing(), 100);
        return;
    }
    
    console.log('Drawing ended. Area:', { minLat, minLon, maxLat, maxLon });
    
    // Reset drawing state
    rectangleStartPoint = null;
    toggleDrawRectangle();
    
    // Search in drawn area
    searchInBoundingBox(minLat, minLon, maxLat, maxLon, 'drawn area');
}

function onRectangleMouseMove(e) {
    if (!isDrawingRectangle || !isMouseDown || !rectangleStartPoint) return;
    
    // Get coordinates from canvas position
    const rect = map.getCanvas().getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert canvas position to lngLat
    const lngLat = map.unproject([x, y]);
    const currentPoint = [lngLat.lng, lngLat.lat];
    
    // Create rectangle coordinates for preview
    const coordinates = [[
        rectangleStartPoint,
        [currentPoint[0], rectangleStartPoint[1]],
        currentPoint,
        [rectangleStartPoint[0], currentPoint[1]],
        rectangleStartPoint
    ]];
    
    // Update or create rectangle layer
    if (map.getSource('search-rectangle')) {
        map.getSource('search-rectangle').setData({
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: coordinates
            }
        });
    } else {
        map.addSource('search-rectangle', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: coordinates
                }
            }
        });
        
        // Fill layer (semi-transparent)
        map.addLayer({
            id: 'search-rectangle-fill',
            type: 'fill',
            source: 'search-rectangle',
            paint: {
                'fill-color': '#64b5f6',
                'fill-opacity': 0.15
            }
        });
        
        // Border layer (animated dashes)
        map.addLayer({
            id: 'search-rectangle',
            type: 'line',
            source: 'search-rectangle',
            paint: {
                'line-color': '#2196F3',
                'line-width': 4,
                'line-dasharray': [3, 3]
            }
        });
        
        // Outer glow
        map.addLayer({
            id: 'search-rectangle-glow',
            type: 'line',
            source: 'search-rectangle',
            paint: {
                'line-color': '#64b5f6',
                'line-width': 8,
                'line-opacity': 0.3,
                'line-blur': 4
            }
        });
    }
}

// Helper function for bounding box search (used by all area search methods)
async function searchInBoundingBox(minLat, minLon, maxLat, maxLon, areaName, options = {}) {
    const { silent = false } = options;
    if (!silent) {
        showToast(`🔍 Searching vessels in ${areaName}...`, 'info', 2000);
    }
    console.log(`🔎 searchInBoundingBox called: ${areaName}`, { minLat, minLon, maxLat, maxLon });
    
    // First try to filter from currently visible vessels (faster)
    const localVessels = Array.from(aisVessels.values()).filter(vessel => {
        return vessel.latitude >= minLat && 
               vessel.latitude <= maxLat && 
               vessel.longitude >= minLon && 
               vessel.longitude <= maxLon;
    });
    const uniqueLocalVessels = dedupeVesselsByMmsi(localVessels);
    const filteredLocalVessels = filterByActiveFilters(uniqueLocalVessels);
    
    console.log(`Found ${filteredLocalVessels.length} vessels in local aisVessels cache`);
    
    if (filteredLocalVessels.length > 0) {
        // Found vessels in local cache - DO NOT add to myVessels automatically
        console.log(`Found ${filteredLocalVessels.length} vessels in local cache`);
        
        // Show found vessels on map without adding to tracked list
        ensureAllVesselsMode();
        allVessels = new Map([...myVessels, ...aisVessels]);
        refreshMapWithFilters();

        updateSearchResultsList(filteredLocalVessels);

        let message = `✅ Found ${filteredLocalVessels.length} vessel${filteredLocalVessels.length !== 1 ? 's' : ''} in ${areaName}`;
        if (activeFilters.size > 0) {
            const filterNames = Array.from(activeFilters).join(', ');
            message += `\n🔍 Active filters: ${filterNames}`;
        }
        if (!silent) {
            showToast(message, 'success');
        }
        return;
    }
    
    // If no local vessels found, always try API (don't check showAllVessels)
    console.log('No local vessels found, hitting API...');
    try {
        const url = `/api/vessels/bbox?min_lat=${minLat}&min_lon=${minLon}&max_lat=${maxLat}&max_lon=${maxLon}`;
        console.log('Fetching from:', url);
        const response = await fetch(url);

        if (!response.ok) throw new Error('Fetch failed');

        const vessels = await response.json();
        const uniqueVessels = dedupeVesselsByMmsi(vessels);
        const filteredVessels = filterByActiveFilters(uniqueVessels);
        console.log(`API returned ${filteredVessels.length} vessels`);
        
        if (filteredVessels.length === 0) {
            updateSearchResultsList([]);
            if (!silent) {
                showToast(`No vessels found in ${areaName}`, 'warning');
            }
            return;
        }

        // Add to aisVessels (live pool), NOT myVessels
        uniqueVessels.forEach(vessel => {
            aisVessels.set(vessel.mmsi, vessel);
        });
        
        // Update map with new vessels - rebuild allVessels
        ensureAllVesselsMode();
        allVessels = new Map([...myVessels, ...aisVessels]);
        refreshMapWithFilters();

        updateSearchResultsList(filteredVessels);
        
        let message = `✅ Found ${filteredVessels.length} vessel${filteredVessels.length !== 1 ? 's' : ''} in ${areaName}`;
        if (activeFilters.size > 0) {
            const filterNames = Array.from(activeFilters).join(', ');
            message += `\n🔍 Active filters: ${filterNames}`;
        }
        if (!silent) {
            showToast(message, 'success');
        }
         
    } catch (error) {
        console.error('Search error:', error);
        if (!silent) {
            showToast('Error searching vessels', 'error');
        }
    }
}


// ==================== VESSEL SOURCE TOGGLE ====================

function toggleVesselSource() {
    showAllVessels = !showAllVessels;
    
    const toggle = document.getElementById('vessel-source-toggle');
    const statusText = document.getElementById('toggle-status');
    
    if (showAllVessels) {
        toggle.classList.add('active');
        statusText.classList.add('active');
        statusText.textContent = 'All Vessels';

        // Ensure AIS stream connection is active
        if (!aisWebSocket || aisWebSocket.readyState !== WebSocket.OPEN) {
            connectToAISStream();
        }

        // If no AIS data yet, fetch vessels for current view as a fallback
        if (aisVessels.size === 0 && typeof searchCurrentView === 'function') {
            searchCurrentView();
        }
        
        // Show all vessels on map (my vessels + AIS vessels)
        allVessels = new Map([...myVessels, ...aisVessels]);
        refreshMapWithFilters();
        showToast('🌍 Showing all vessels', 'success');
    } else {
        toggle.classList.remove('active');
        statusText.classList.remove('active');
        statusText.textContent = 'My Vessels Only';
        
        // Show only user's tracked vessels
        allVessels = new Map([...myVessels]);
        refreshMapWithFilters();
        showToast('📍 Showing your tracked vessels only', 'info');
    }
}

function connectToAISStream() {
    if (aisWebSocket && aisWebSocket.readyState === WebSocket.OPEN) {
        console.log('Already connected to AIS Stream');
        return;
    }
    
    try {
        console.log('🔌 Connecting to AIS Stream via backend proxy...');
        console.log('showAllVessels state:', showAllVessels);
        
        // Connect to our backend proxy (not directly to AISStream)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/ais-stream`;
        console.log('WebSocket URL:', wsUrl);
        aisWebSocket = new WebSocket(wsUrl);
        console.log('WebSocket object created, readyState:', aisWebSocket.readyState);
        
        // Connection timeout (10 seconds)
        const connectionTimeout = setTimeout(() => {
            if (aisWebSocket.readyState !== WebSocket.OPEN) {
                console.error('⏱️ WebSocket connection timeout - could not connect after 10 seconds');
                console.error('Final readyState:', aisWebSocket.readyState);
                aisWebSocket.close();
                showToast('❌ Could not connect to AIS Stream - timeout', 'error');
            }
        }, 10000);
        
        aisWebSocket.onopen = () => {
            clearTimeout(connectionTimeout);
            aisStreamConnected = true;
            console.log('✅ AIS Stream connected! Collecting vessel data in background...');
            console.log(`📊 Display mode: ${showAllVessels ? 'All Vessels' : 'My Vessels Only'}`);
            // No toast notification - AIS runs silently in background
        };
        
        aisWebSocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('📨 Received message from proxy:', message.type);
                
                if (message.type === 'vessel_update' && message.data) {
                    const vessel = message.data;
                    console.log('🚢 New vessel:', vessel.name, 'at', vessel.latitude, vessel.longitude);
                    console.log('📊 Vessel data:', {
                        ship_type: vessel.ship_type,
                        ship_category: vessel.ship_category,
                        is_ballast: vessel.is_ballast,
                        draught: vessel.draught
                    });
                    
                    const isTracked = myVessels.has(vessel.mmsi);
                    if (dynamicBBoxEnabled && currentViewportBounds && !isTracked) {
                        if (!isWithinBounds(vessel, currentViewportBounds)) {
                            return;
                        }
                    }

                    // Collect AIS vessels in background
                    aisVessels.set(vessel.mmsi, vessel);
                    
                    // Keep tracked vessels up to date with latest AIS data
                    if (myVessels.has(vessel.mmsi)) {
                        const existing = myVessels.get(vessel.mmsi);
                        myVessels.set(vessel.mmsi, { ...existing, ...vessel });
                    }
                    
                                        // Update map immediately for first batch, then every 10 vessels
                                        // OR if this specific vessel is in tracked list (to update its position live)
                                        const shouldUpdateMap = aisVessels.size <= 20 || aisVessels.size % 10 === 0 || myVessels.has(vessel.mmsi);
                                        if (shouldUpdateMap) {
                                            if (showAllVessels) {
                                                // Rebuild allVessels and update map
                                                allVessels = new Map([...myVessels, ...aisVessels]);
                                                refreshMapWithFilters();
                                            } else if (myVessels.has(vessel.mmsi)) {
                                                // Even in "My Vessels" mode, update position if it's a tracked vessel
                                                allVessels = new Map([...myVessels]);
                                                refreshMapWithFilters();
                                            }
                        
                                            if (aisVessels.size % 10 === 0 || aisVessels.size <= 20) {
                                                 console.log(`📡 AIS Stream: ${aisVessels.size} AIS vessels collected (${myVessels.size} tracked)`);
                                            }
                                        }

                } else {
                    console.log('📋 Other message:', message);
                }
            } catch (error) {
                console.error('❌ Error parsing message:', error);
                console.error('Raw message:', event.data);
            }
        };
        
        aisWebSocket.onerror = (error) => {
            clearTimeout(connectionTimeout);
            console.error('❌ AIS WebSocket error occurred!');
            console.error('Error event:', error);
            console.error('WebSocket readyState:', aisWebSocket.readyState);
            // Only show error if we're trying to stay connected
            if (showAllVessels) {
                showToast('⚠️ AIS connection error', 'error');
            }
        };
        
        aisWebSocket.onclose = (event) => {
            clearTimeout(connectionTimeout);
            console.log('🔌 AIS WebSocket closed');
            console.log('Close code:', event.code);
            console.log('Close reason:', event.reason);
            console.log('Was clean:', event.wasClean);
            // Only log if unexpected close
            if (showAllVessels) {
                console.log('Unexpected close while in "all vessels" mode');
                
                // Auto-reconnect if still in "all vessels" mode
                aisReconnectTimeout = setTimeout(() => {
                    console.log('🔄 Reconnecting to AIS Stream...');
                    connectToAISStream();
                }, 5000);
            } else {
                console.log('✅ AIS WebSocket closed gracefully');
            }
        };
        
    } catch (error) {
        console.error('Failed to connect to AIS Stream:', error);
        showToast('Failed to connect to live AIS data', 'error');
    }
}

function disconnectFromAISStream() {
    // This function is no longer needed - AIS stream stays connected
    // Just clear the display without disconnecting
    console.log('📍 AIS Stream remains connected in background');
}

// ==================== AUTO-START AIS STREAM ====================

// Start AIS Stream automatically when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        console.log('🚀 Auto-starting AIS Stream...');

        showListView('tracked');

        // Set toggle UI to All Vessels on load
        const toggle = document.getElementById('vessel-source-toggle');
        const statusText = document.getElementById('toggle-status');
        if (toggle && statusText) {
            toggle.classList.add('active');
            statusText.classList.add('active');
            statusText.textContent = 'All Vessels';
        }
        
        // Load user's vessels from database if logged in
        if (authToken) {
            console.log('📦 Loading vessels from database...');
            await loadMyVesselsFromDatabase();
        }
        
        setTimeout(() => {
            connectToAISStream();
            if (typeof searchCurrentView === 'function') {
                searchCurrentView({ silent: true });
            }
        }, 2000); // Wait 2 seconds for map to initialize
    });
} else {
    console.log('🚀 Auto-starting AIS Stream...');

    showListView('tracked');

    // Set toggle UI to All Vessels on load
    const toggle = document.getElementById('vessel-source-toggle');
    const statusText = document.getElementById('toggle-status');
    if (toggle && statusText) {
        toggle.classList.add('active');
        statusText.classList.add('active');
        statusText.textContent = 'All Vessels';
    }
    
    // Load user's vessels from database if logged in
    if (authToken) {
        console.log('📦 Loading vessels from database...');
        loadMyVesselsFromDatabase();
    }
    
    setTimeout(() => {
        connectToAISStream();
        if (typeof searchCurrentView === 'function') {
            searchCurrentView({ silent: true });
        }
    }, 2000);
}

// Export functions to global scope for HTML onclick handlers (at end of file after all definitions)
window.confirmDeleteVessel = confirmDeleteVessel;
window.toggleVesselSource = toggleVesselSource;
window.toggleFilter = toggleFilter;
window.showListView = showListView;
window.toggleDrawRectangle = toggleDrawRectangle;
window.cancelDrawIfActive = cancelDrawIfActive;
window.searchCurrentView = searchCurrentView;
window.updateViewportBounds = updateViewportBounds;
window.closeModal = closeModal;
window.saveNote = saveNote;
window.deleteNote = deleteNote;
window.logout = logout;
