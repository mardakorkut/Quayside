/**
 * WebSocket Client for Real-time Vessel Updates
 * Handles connection and data streaming from FastAPI backend
 */

let ws;
let wsConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000; // 3 seconds

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/vessels`;

    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

    ws = new WebSocket(wsUrl);

    ws.onopen = function(event) {
        console.log('✅ WebSocket connected');
        wsConnected = true;
        reconnectAttempts = 0;
        updateConnectionStatus(true);

        // Send initial subscription
        subscribeToVessels();
    };

    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onerror = function(error) {
        console.error('❌ WebSocket error:', error);
        updateConnectionStatus(false);
    };

    ws.onclose = function(event) {
        console.warn('⚠️  WebSocket disconnected');
        wsConnected = false;
        updateConnectionStatus(false);
        attemptReconnect();
    };
}

function attemptReconnect() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`🔄 Attempting reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(connectWebSocket, RECONNECT_DELAY);
    } else {
        console.error('❌ Max reconnection attempts reached');
    }
}

function handleWebSocketMessage(data) {
    const { type, vessel, vessels, message, timestamp } = data;

    switch(type) {
        case 'connection':
            console.log('📨 Connection confirmed:', message);
            break;

                case 'vessel_update':
            // Sadece loglama yap, listeyi otomatik guncelleme
            // Listeyi vessel-tracker.js icindeki mantik yonetecek
            if (vessel) {
                // Burada dogrudan UI update yapma, vessel-tracker.js'deki 
                // ana veri yapilarina birak
                console.log('Single vessel update received via WS1 (ignored here)');
            }
            break;

        case 'vessels_update':
            // Sadece loglama yap, listeyi otomatik guncelleme
            if (vessels) {
                console.log(`📍 Received ${vessels.length} vessels via WS1 (ignored here)`);
            }
            break;


        case 'error':
            console.error('❌ Server error:', message);
            showNotification(message, 'error');
            break;

        case 'subscribed':
            console.log('📍 Subscribed:', message);
            showNotification(`Subscribed to area: ${message}`, 'success');
            break;

        case 'unsubscribed':
            console.log('Unsubscribed:', message);
            break;

        default:
            console.log('Unknown message type:', type, data);
    }
}

function subscribeToVessels() {
    if (!wsConnected) return;

    const message = {
        type: 'subscribe',
        bbox: '40.0,27.0,42.0,30.0'  // Default Istanbul area
    };

    ws.send(JSON.stringify(message));
    console.log('📍 Vessel subscription sent');
}

function unsubscribeFromVessels() {
    if (!wsConnected) return;

    const message = {
        type: 'unsubscribe'
    };

    ws.send(JSON.stringify(message));
}

function updateConnectionStatus(connected) {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('connection-text');

    if (connected) {
        statusDot.classList.remove('disconnected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';
        statusText.style.color = '#28a745';
    } else {
        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Disconnected';
        statusText.style.color = '#dc3545';
    }
}

function updateConnectionCount(count) {
    document.getElementById('connection-count').textContent = count;
}

function updateVesselCount(count) {
    document.getElementById('vessel-count').textContent = count;
}

function updateTimestamp() {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    document.getElementById('last-update').textContent = time;
}

function showNotification(message, type = 'info') {
    // Simple notification (you can replace with a better notification library)
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Initialize WebSocket connection when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connectWebSocket);
} else {
    connectWebSocket();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
});
