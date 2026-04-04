let map;
let marker;
let heatLayer;
let lastPosition = null;
let lastMoveTime = Date.now();
let hotspots = [];
let orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
let earningsHistory = JSON.parse(localStorage.getItem('earningsHistory') || '[]');
let idleLimitMinutes = parseInt(localStorage.getItem('idleLimitMinutes') || '10');
let lastFetchTime = 0;
const FETCH_COOLDOWN_MS = 60000;

const OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

lucide.createIcons();

// --- Initialization ---

function initMap(lat, lng) {
    if (map) {
        map.setView([lat, lng], 16);
        marker.setLatLng([lat, lng]);
        return;
    }
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([lat, lng], 16);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { 
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    
    const pulseIcon = L.divIcon({ className: 'user-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
    marker = L.marker([lat, lng], { icon: pulseIcon }).addTo(map);
    
    updateHeatmap();
    fetchNearbyHotspots(lat, lng);
}

// --- Utils ---

function formatRupiah(amount) {
    return 'Rp ' + amount.toLocaleString('id-ID');
}

function getTodayDate() {
    return new Date().toLocaleDateString('id-ID');
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2-lat1)*Math.PI/180;
    const dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// --- Heatmap & History ---

function updateHeatmap() {
    if (heatLayer) map.removeLayer(heatLayer);
    const heatData = orderHistory.map(o => [o.lat, o.lng, 0.5]);
    heatLayer = L.heatLayer(heatData, {
        radius: 35, blur: 15, maxZoom: 17,
        gradient: { 0.4: 'blue', 0.65: 'lime', 1: 'red' }
    }).addTo(map);
    updateHistoryUI();
}

function logOrder() {
    if (!lastPosition) return alert("🛰️ Tunggu GPS stabil!");
    const newOrder = {
        id: Date.now(), lat: lastPosition.lat, lng: lastPosition.lng,
        time: new Date().toLocaleTimeString(), date: getTodayDate()
    };
    orderHistory.push(newOrder);
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
    updateHeatmap();
}

function updateHistoryUI() {
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    if (orderHistory.length === 0) {
        list.innerHTML = '<div class="recommendation-item">Belum ada titik gacor tertanda.</div>';
    } else {
        [...orderHistory].reverse().slice(0, 10).forEach(order => {
            const div = document.createElement('div');
            div.className = 'recommendation-item';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🥡 Order Terdeteksi</span>
                    <span style="font-size:0.7rem; color:coral;">${order.time}</span>
                </div>
            `;
            list.appendChild(div);
        });
    }
}

// --- API Logic ---

async function fetchNearbyHotspots(lat, lng) {
    const now = Date.now();
    if (now - lastFetchTime < FETCH_COOLDOWN_MS) return;
    lastFetchTime = now;
    
    const badge = document.getElementById('status-badge');
    badge.innerText = "🔍 Mencari Spot...";
    badge.style.background = 'rgba(241, 196, 15, 0.2)';
    badge.style.color = '#f1c40f';

    hotspots.forEach(h => map.removeLayer(h));
    hotspots = [];

    // QUERY LEBIH KUAT: Mencari Node, Way, dan Relation (nwr) agar Gedung/Area Mall ketemu
    // Mencari Restoran, Kafe, Food Court, Minimarket, dan Supermarket
    const query = `[out:json][timeout:15];(nwr(around:1500,${lat},${lng})[amenity~"restaurant|fast_food|cafe|food_court"];nwr(around:1500,${lat},${lng})[shop~"convenience|supermarket|mall"];);out center 30;`;
    const encodedQuery = encodeURIComponent(query);
    
    let data = null;
    let errorMsg = "Standby";

    for (const mirror of OVERPASS_MIRRORS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(`${mirror}?data=${encodedQuery}`, { signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) {
                data = await response.json();
                break;
            } else {
                errorMsg = "Server Penuh";
            }
        } catch (e) {
            errorMsg = "Offline";
        }
    }

    if (!data || !data.elements || data.elements.length === 0) {
        badge.innerText = `☕ ${errorMsg}`;
        badge.style.background = 'rgba(148, 163, 184, 0.1)';
        badge.style.color = '#94a3b8';
        showStaticRecommendations();
        return;
    }

    const places = data.elements.map(el => {
        const coords = el.center || { lat: el.lat, lon: el.lon };
        return {
            name: el.tags.name || el.tags.amenity || "Area Rame",
            type: el.tags.amenity || el.tags.shop || "Spot",
            lat: coords.lat, lon: coords.lon,
            distance: Math.round(getDistance(lat, lng, coords.lat, coords.lon))
        };
    }).sort((a, b) => a.distance - b.distance);

    places.forEach(place => {
        const color = place.type.includes('restaurant') ? '#2ecc71' : '#3498db';
        const spot = L.circle([place.lat, place.lon], { 
            color: color, fillColor: color, fillOpacity: 0.3, radius: 45, weight: 1 
        }).addTo(map);
        spot.bindPopup(`<b>${place.name}</b><br><small>${place.type}</small><br><a href="https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}" target="_blank">🚀 Gas</a>`);
        hotspots.push(spot);
    });

    updateUIRecommendations(places);
}

function updateUIRecommendations(places) {
    const badge = document.getElementById('status-badge');
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '';
    
    badge.innerText = "🔥 Sangat Ramai";
    badge.style.background = 'rgba(46, 204, 113, 0.15)';
    badge.style.color = '#2ecc71';

    places.slice(0, 6).forEach(place => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                   <strong style="font-size:0.9rem;">${place.name}</strong><br>
                   <small style="color:var(--text-dim)">📍 ${place.distance}m</small>
                </div>
                <a href="https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}" target="_blank" style="padding:8px; background:rgba(46,204,113,0.1); border-radius:10px; text-decoration:none;">🛵</a>
            </div>
        `;
        list.appendChild(div);
    });
}

function showStaticRecommendations() {
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '<div class="recommendation-item">Belum ada data mall/restoran besar. Cobalah geser ke jalan utama terdekat.</div>';
}

// --- Tracking ---

function startTracking() {
    confirm("Izinkan aplikasi menggunakan GPS agar bisa mencarikan spot gacor.");
    navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        initMap(latitude, longitude);
        
        document.getElementById('current-zone-title').innerText = "📍 Lokasi Aktif";
        document.getElementById('current-zone-desc').innerText = `Akurasi GPS baik (${Math.round(accuracy)}m)`;
        
        if (!lastPosition || getDistance(lastPosition.lat, lastPosition.lng, latitude, longitude) > 35) {
            lastMoveTime = Date.now();
            fetchNearbyHotspots(latitude, longitude);
        }
        lastPosition = { lat: latitude, lng: longitude };
        document.getElementById('connection-status').innerText = `Online (${Math.round(accuracy)}m)`;
    }, (err) => {
        document.getElementById('current-zone-title').innerText = "⚠️ GPS Mati";
    }, { enableHighAccuracy: true });
}

function startIdleTimer() {
    const timerEl = document.getElementById('idle-timer');
    const progressEl = document.getElementById('timer-progress');
    setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastMoveTime) / 1000);
        timerEl.innerText = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
        progressEl.setAttribute('stroke-dasharray', `${Math.min((elapsed/(idleLimitMinutes*60))*100, 100)}, 100`);
    }, 1000);
}

// --- Stats & Events ---

function updateStatisticsUI() {
    const today = getTodayDate();
    const todayEarnings = earningsHistory.filter(e => e.date === today);
    const todayOrdersCount = orderHistory.filter(o => o.date === today).length;
    const totalTodayAmount = todayEarnings.reduce((sum, e) => sum + e.amount, 0);
    document.getElementById('stat-today-orders').innerText = todayOrdersCount;
    document.getElementById('stat-today-earnings').innerText = formatRupiah(totalTodayAmount);
    
    const list = document.getElementById('earnings-list');
    list.innerHTML = '';
    [...todayEarnings].reverse().slice(0, 5).forEach(e => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        div.innerHTML = `<span>💸 ${formatRupiah(e.amount)}</span> <span style="font-size:0.7rem;">${e.time}</span>`;
        list.appendChild(div);
    });
}

function addEarning() {
    const input = document.getElementById('input-earning');
    const amount = parseInt(input.value);
    if (!amount) return;
    earningsHistory.push({ id: Date.now(), amount, time: new Date().toLocaleTimeString(), date: getTodayDate() });
    localStorage.setItem('earningsHistory', JSON.stringify(earningsHistory));
    input.value = '';
    updateStatisticsUI();
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetView = btn.dataset.view;
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${targetView}`).classList.add('active');
        if (targetView === 'statistik') updateStatisticsUI();
        lucide.createIcons();
    });
});

document.getElementById('log-order-btn').addEventListener('click', logOrder);
document.getElementById('btn-add-earning').addEventListener('click', addEarning);

startTracking();
startIdleTimer();
updateStatisticsUI();
updateHeatmap();
