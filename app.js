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
const FETCH_COOLDOWN_MS = 15000;

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
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
    const pulseIcon = L.divIcon({ className: 'user-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
    marker = L.marker([lat, lng], { icon: pulseIcon }).addTo(map);
    updateHeatmap();
    fetchNearbyHotspots(lat, lng);
}

// --- Smart Logic (Core of Smart Helper) ---

function calculateGacorScore(place, currentHour) {
    let score = 30; // Skor dasar
    const type = (place.type || "").toLowerCase();
    const name = (place.name || "").toLowerCase();

    // 1. Tipe Prioritas
    if (type.includes('mall')) score += 50;
    if (type.includes('food_court')) score += 45;
    if (type.includes('fast_food')) score += 40;
    if (type.includes('restaurant')) score += 35;
    if (type.includes('supermarket')) score += 30;
    if (type.includes('convenience') || type.includes('minimarket')) score += 20;

    // 2. Logika Waktu Gacor
    if (currentHour >= 11 && currentHour <= 14) { // Puncak Makan Siang
        if (type.includes('restaurant') || type.includes('food_court') || name.includes('ayam') || name.includes('nasi')) score += 30;
    }
    if (currentHour >= 17 && currentHour <= 20) { // Puncak Makan Malam
        if (type.includes('fast_food') || type.includes('martabak') || name.includes('sate') || name.includes('bakso')) score += 25;
    }
    if (currentHour >= 21 || currentHour <= 3) { // Larut Malam
        if (type.includes('convenience') || name.includes('warmindo')) score += 40;
    }

    // 3. Jarak (Optimalitas)
    if (place.distance < 400) score += 20;
    else if (place.distance > 1500) score -= 20;

    return Math.min(score, 100);
}

async function fetchNearbyHotspots(lat, lng) {
    const now = Date.now();
    if (now - lastFetchTime < FETCH_COOLDOWN_MS) return;
    lastFetchTime = now;
    
    const badge = document.getElementById('status-badge');
    badge.innerText = "🔍 Analisis Order...";
    badge.style.background = 'rgba(241, 196, 15, 0.2)';
    badge.style.color = '#f1c40f';

    hotspots.forEach(h => map.removeLayer(h));
    hotspots = [];

    const query = `[out:json][timeout:15];(nwr(around:2000,${lat},${lng})[amenity~"restaurant|fast_food|cafe|food_court|pharmacy"];nwr(around:2000,${lat},${lng})[shop~"convenience|supermarket|mall"];);out center 50;`;
    const encodedQuery = encodeURIComponent(query);
    
    let data = null;
    for (const mirror of OVERPASS_MIRRORS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            const response = await fetch(`${mirror}?data=${encodedQuery}`, { signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) { data = await response.json(); break; }
        } catch (e) {}
    }

    if (!data || !data.elements || data.elements.length === 0) {
        badge.innerText = "☕ Standby";
        showStaticRecommendations();
        return;
    }

    const currentHour = new Date().getHours();
    const places = data.elements.map(el => {
        const coords = el.center || { lat: el.lat, lon: el.lon };
        const p = {
            name: el.tags.name || el.tags.shop || el.tags.amenity || "Spot",
            type: el.tags.amenity || el.tags.shop || "Point",
            lat: coords.lat, lon: coords.lon,
            distance: Math.round(getDistance(lat, lng, coords.lat, coords.lon))
        };
        p.gacorScore = calculateGacorScore(p, currentHour);
        return p;
    }).sort((a, b) => b.gacorScore - a.gacorScore); // SORT BY SCORE! (Bukan Jarak)

    places.slice(0, 15).forEach(place => {
        let color = '#3498db';
        if (place.gacorScore > 75) color = '#e74c3c'; // Merah (Hot)
        else if (place.gacorScore > 50) color = '#f1c40f'; // Kuning (Medium)
        
        const spot = L.circle([place.lat, place.lon], { 
            color: color, fillColor: color, fillOpacity: 0.3, radius: 55, weight: 1 
        }).addTo(map);
        spot.bindPopup(`<b>${place.name}</b><br>Skor Gacor: ${place.gacorScore}%`);
        hotspots.push(spot);
    });

    updateSmartRecommendations(places);
}

function updateSmartRecommendations(places) {
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '';
    
    const badge = document.getElementById('status-badge');
    badge.innerText = "🎯 Spot Terdeteksi";
    badge.style.background = 'rgba(46, 204, 113, 0.15)';
    badge.style.color = '#2ecc71';

    places.slice(0, 6).forEach(place => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        let levelColor = '#2ecc71';
        let levelText = "Potensi Sedang";
        if (place.gacorScore > 75) { levelColor = '#e74c3c'; levelText = "🔥 SANGAT GACOR"; }
        else if (place.gacorScore > 50) { levelColor = '#f1c40f'; levelText = "⚠️ Potensi Tinggi"; }

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div style="flex:1;">
                   <div style="display:flex; align-items:center; gap:8px;">
                        <strong style="font-size:0.95rem;">${place.name}</strong>
                        <span style="font-size:0.6rem; padding:2px 6px; border-radius:4px; background:${levelColor}22; color:${levelColor}; border:1px solid ${levelColor}44;">${place.gacorScore}%</span>
                   </div>
                   <small style="color:${levelColor}; font-weight:600; display:block; margin:2px 0;">${levelText}</small>
                   <small style="color:var(--text-dim)">Jarak: ${place.distance}m</small>
                </div>
                <a href="https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}" target="_blank" style="padding:10px; background:rgba(255,255,255,0.05); border-radius:12px; border:1px solid rgba(255,255,255,0.1);">🛵</a>
            </div>
        `;
        list.appendChild(div);
    });
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2-lat1)*Math.PI/180;
    const dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// --- Tracking & Other Functions (Keep same) ---
// ... (Sisa fungsi startTracking, initMap dsb tetap sama)

function showStaticRecommendations() {
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '<div class="recommendation-item">Belum ada spot terdeteksi. Cobalah mendekat ke area jalan besar atau pusat keramaian.</div>';
}

function updateHeatmap() {
    if (heatLayer && map) map.removeLayer(heatLayer);
    const heatData = orderHistory.map(o => [o.lat, o.lng, 0.5]);
    if (map) heatLayer = L.heatLayer(heatData, { radius: 35, blur: 15, maxZoom: 17 }).addTo(map);
}

function startTracking() {
    navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        initMap(latitude, longitude);
        document.getElementById('current-zone-title').innerText = "📍 Lokasi Aktif";
        if (!lastPosition || getDistance(lastPosition.lat, lastPosition.lng, latitude, longitude) > 35) {
            lastMoveTime = Date.now();
            fetchNearbyHotspots(latitude, longitude);
        }
        lastPosition = { lat: latitude, lng: longitude };
        document.getElementById('connection-status').innerText = `Online (${Math.round(accuracy)}m)`;
    }, null, { enableHighAccuracy: true });
}

function startIdleTimer() {
    setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastMoveTime) / 1000);
        document.getElementById('idle-timer').innerText = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
    }, 1000);
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetView = btn.dataset.view;
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${targetView}`).classList.add('active');
    });
});

startTracking();
startIdleTimer();
updateHeatmap();
