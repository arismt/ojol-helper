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
const FETCH_COOLDOWN_MS = 15000; // Dikurangi jadi 15 detik agar lebih responsif

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

// --- API Logic ---

async function fetchNearbyHotspots(lat, lng) {
    const now = Date.now();
    if (now - lastFetchTime < FETCH_COOLDOWN_MS) return;
    lastFetchTime = now;
    
    const badge = document.getElementById('status-badge');
    const list = document.getElementById('recommendation-list');
    
    badge.innerText = "🔍 Mencari Spot...";
    badge.style.background = 'rgba(241, 196, 15, 0.2)';
    badge.style.color = '#f1c40f';
    badge.style.cursor = 'pointer';
    
    list.innerHTML = '<div class="recommendation-item">📡 Sedang menanyakan ke satelit peta...</div>';

    hotspots.forEach(h => map.removeLayer(h));
    hotspots = [];

    // QUERY SUPER LUAS: Restoran, Mall, Minimarket, Laundry, Apotek, Toko Roti, Bengkel (Radius 1.8km)
    const query = `[out:json][timeout:15];(nwr(around:1800,${lat},${lng})[amenity~"restaurant|fast_food|cafe|food_court|pharmacy|bakery"];nwr(around:1800,${lat},${lng})[shop~"convenience|supermarket|mall|laundry"];);out center 40;`;
    const encodedQuery = encodeURIComponent(query);
    
    let data = null;
    let statusText = "Standby";

    for (const mirror of OVERPASS_MIRRORS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            const response = await fetch(`${mirror}?data=${encodedQuery}`, { signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) {
                data = await response.json();
                break;
            }
        } catch (e) {
            statusText = "Koneksi Bermasalah";
        }
    }

    if (!data || !data.elements || data.elements.length === 0) {
        badge.innerText = `⚠️ Kosong`;
        badge.style.background = 'rgba(231, 76, 60, 0.15)';
        badge.style.color = '#e74c3c';
        list.innerHTML = '<div class="recommendation-item">❌ Tidak ditemukan resto/minimarket dalam radius 1.8km. Coba geser keluar kompleks atau ke jalan utama.</div>';
        return;
    }

    const places = data.elements.map(el => {
        const coords = el.center || { lat: el.lat, lon: el.lon };
        return {
            name: el.tags.name || el.tags.amenity || el.tags.shop || "Spot Rame",
            type: el.tags.amenity || el.tags.shop || "Point",
            lat: coords.lat, lon: coords.lon,
            distance: Math.round(getDistance(lat, lng, coords.lat, coords.lon))
        };
    }).sort((a, b) => a.distance - b.distance);

    places.forEach(place => {
        const color = '#2ecc71';
        const spot = L.circle([place.lat, place.lon], { 
            color: color, fillColor: color, fillOpacity: 0.3, radius: 50, weight: 1 
        }).addTo(map);
        spot.bindPopup(`<b>${place.name}</b><br><a href="https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}" target="_blank">🚀 Navigasi</a>`);
        hotspots.push(spot);
    });

    updateUIRecommendations(places);
}

function updateUIRecommendations(places) {
    const badge = document.getElementById('status-badge');
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '';
    
    badge.innerText = "🔥 Spot Ditemukan";
    badge.style.background = 'rgba(46, 204, 113, 0.15)';
    badge.style.color = '#2ecc71';

    places.slice(0, 8).forEach(place => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                   <strong style="font-size:0.9rem;">${place.name}</strong><br>
                   <small style="color:var(--text-dim)">📍 ${place.distance}m</small>
                </div>
                <a href="https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}" target="_blank" style="padding:10px; background:rgba(46,204,113,0.1); border-radius:12px; text-decoration:none;">🛵</a>
            </div>
        `;
        list.appendChild(div);
    });
}

// --- Tracking ---

function startTracking() {
    navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        initMap(latitude, longitude);
        
        document.getElementById('current-zone-title').innerText = "📍 Lokasi Aktif";
        document.getElementById('current-zone-desc').innerText = `Akurasi GPS Baik (${Math.round(accuracy)}m)`;
        
        if (!lastPosition || getDistance(lastPosition.lat, lastPosition.lng, latitude, longitude) > 35) {
            lastMoveTime = Date.now();
            fetchNearbyHotspots(latitude, longitude);
        }
        lastPosition = { lat: latitude, lng: longitude };
        document.getElementById('connection-status').innerText = `Online (${Math.round(accuracy)}m)`;
    }, (err) => {
        document.getElementById('current-zone-title').innerText = "⚠️ GPS Bermasalah";
        document.getElementById('current-zone-desc').innerText = "Sinyal GPS hilang/lemah (mungkin di dalam ruangan).";
    }, { enableHighAccuracy: true });
}

// Klik badge untuk cari paksa (Force Refresh)
document.getElementById('status-badge').addEventListener('click', () => {
    if (lastPosition) {
        lastFetchTime = 0; // Reset cooldown
        fetchNearbyHotspots(lastPosition.lat, lastPosition.lng);
    }
});

// --- Timer & History Logic (Sama seperti sebelumnya) ---

function startIdleTimer() {
    const timerEl = document.getElementById('idle-timer');
    const progressEl = document.getElementById('timer-progress');
    setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastMoveTime) / 1000);
        timerEl.innerText = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
        progressEl.setAttribute('stroke-dasharray', `${Math.min((elapsed/(idleLimitMinutes*60))*100, 100)}, 100`);
    }, 1000);
}

function updateHeatmap() {
    if (heatLayer && map) map.removeLayer(heatLayer);
    if (!map) return;
    const heatData = orderHistory.map(o => [o.lat, o.lng, 0.5]);
    heatLayer = L.heatLayer(heatData, { radius: 35, blur: 15, maxZoom: 17 }).addTo(map);
}

document.getElementById('log-order-btn').addEventListener('click', () => {
    if (!lastPosition) return alert("🛰️ Tunggu GPS stabil!");
    orderHistory.push({ id: Date.now(), lat: lastPosition.lat, lng: lastPosition.lng, time: new Date().toLocaleTimeString(), date: getTodayDate() });
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
    updateHeatmap();
    alert("🚀 Titik Gacor tersimpan!");
});

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetView = btn.dataset.view;
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${targetView}`).classList.add('active');
        lucide.createIcons();
    });
});

startTracking();
startIdleTimer();
updateHeatmap();
