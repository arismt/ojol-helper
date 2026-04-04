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
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    
    // User pulse marker
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
    if (!lastPosition) return alert("🛰️ Tunggu GPS stabil dulu ya!");
    const newOrder = {
        id: Date.now(), lat: lastPosition.lat, lng: lastPosition.lng,
        time: new Date().toLocaleTimeString(), date: getTodayDate()
    };
    orderHistory.push(newOrder);
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
    updateHeatmap();
    alert("🚀 Titik Gacor tersimpan di HP Anda!");
}

function updateHistoryUI() {
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    if (orderHistory.length === 0) {
        list.innerHTML = '<div class="recommendation-item">Belum ada titik gacor tertanda.</div>';
        return;
    }
    [...orderHistory].reverse().slice(0, 10).forEach(order => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>🥡 Order Terdeteksi</span>
                <span style="font-size:0.7rem; color:coral;">${order.time}</span>
            </div>
            <small style="color:var(--text-dim)">${order.date}</small>
        `;
        list.appendChild(div);
    });
}

// --- Statistics Logic ---

function addEarning() {
    const input = document.getElementById('input-earning');
    const amount = parseInt(input.value);
    if (isNaN(amount) || amount <= 0) return alert("⚠️ Masukkan nominal yang benar!");

    const newEarning = {
        id: Date.now(), amount: amount, time: new Date().toLocaleTimeString(), date: getTodayDate()
    };

    earningsHistory.push(newEarning);
    localStorage.setItem('earningsHistory', JSON.stringify(earningsHistory));
    input.value = '';
    updateStatisticsUI();
}

function updateStatisticsUI() {
    const today = getTodayDate();
    const todayEarnings = earningsHistory.filter(e => e.date === today);
    const todayOrdersCount = orderHistory.filter(o => o.date === today).length;
    const totalTodayAmount = todayEarnings.reduce((sum, e) => sum + e.amount, 0);

    document.getElementById('stat-today-orders').innerText = todayOrdersCount;
    document.getElementById('stat-today-earnings').innerText = formatRupiah(totalTodayAmount);
    
    const list = document.getElementById('earnings-list');
    list.innerHTML = '';
    if (todayEarnings.length === 0) {
        list.innerHTML = '<div class="recommendation-item">Belum ada catatan hari ini.</div>';
    } else {
        [...todayEarnings].reverse().forEach(e => {
            const div = document.createElement('div');
            div.className = 'recommendation-item';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span>💸 ${formatRupiah(e.amount)}</span>
                    <span style="font-size:0.7rem; color:var(--text-dim);">${e.time}</span>
                </div>
            `;
            list.appendChild(div);
        });
    }
    updateWeeklyChart();
}

function updateWeeklyChart() {
    const container = document.getElementById('weekly-chart');
    if (!container) return;
    container.innerHTML = '';
    
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toLocaleDateString('id-ID'));
    }

    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const earningsMap = days.map(day => {
        return earningsHistory
            .filter(e => e.date === day)
            .reduce((sum, e) => sum + e.amount, 0);
    });

    const maxEarning = Math.max(...earningsMap, 50000);

    days.forEach((day, index) => {
        const amount = earningsMap[index];
        const height = (amount / maxEarning) * 100;
        const dayLabel = index === 6 ? 'H.Ini' : dayNames[new Date(day.split('/').reverse().join('-')).getDay()];
        
        const barWrapper = document.createElement('div');
        barWrapper.className = 'chart-bar-wrapper';
        barWrapper.innerHTML = `
            <span class="chart-value">${amount > 0 ? (amount/1000).toFixed(0) + 'k' : ''}</span>
            <div class="chart-bar ${index === 6 ? 'today' : ''}" style="height: ${Math.max(height, 5)}%"></div>
            <span class="chart-label">${dayLabel}</span>
        `;
        container.appendChild(barWrapper);
    });
}

// --- API & UI Logic ---

async function fetchNearbyHotspots(lat, lng) {
    const now = Date.now();
    if (now - lastFetchTime < FETCH_COOLDOWN_MS) return;
    lastFetchTime = now;
    
    const badge = document.getElementById('status-badge');
    badge.innerText = "🔍 Mencari Spot...";
    badge.classList.remove('green');
    badge.style.background = 'rgba(241, 196, 15, 0.2)';
    badge.style.color = '#f1c40f';

    hotspots.forEach(h => map.removeLayer(h));
    hotspots = [];

    // Query area ramai: Restoran, Mall, Food Court, Minimarket dalam radius 1.2km
    const query = `[out:json][timeout:10];node(around:1200,${lat},${lng})[amenity~"restaurant|fast_food|cafe|marketplace|food_court|mall"];out 20;`;
    const encodedQuery = encodeURIComponent(query);
    
    let data = null;
    for (const mirror of OVERPASS_MIRRORS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const response = await fetch(`${mirror}?data=${encodedQuery}`, { signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) {
                data = await response.json();
                break;
            }
        } catch (e) {}
    }

    if (!data || !data.elements || data.elements.length === 0) {
        badge.innerText = "☕ Standby";
        badge.style.background = 'rgba(148, 163, 184, 0.1)';
        badge.style.color = '#94a3b8';
        showStaticRecommendations();
        return;
    }

    const places = data.elements.map(el => ({
        name: el.tags.name || "Pusat Makanan",
        address: el.tags['addr:street'] || "Area Terdekat",
        lat: el.lat, lon: el.lon,
        distance: Math.round(getDistance(lat, lng, el.lat, el.lon))
    })).sort((a, b) => a.distance - b.distance);

    places.forEach(place => {
        const spot = L.circle([place.lat, place.lon], { 
            color: '#2ecc71', fillColor: '#2ecc71', fillOpacity: 0.3, radius: 45, weight: 1 
        }).addTo(map);
        spot.bindPopup(`<b>${place.name}</b><br><small>${place.address}</small><br><a href="https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}" target="_blank" style="color:#2ecc71; text-decoration:none;">🚀 Gas Ke Sini</a>`);
        hotspots.push(spot);
    });

    updateUIRecommendations(places);
}

function updateUIRecommendations(places) {
    const badge = document.getElementById('status-badge');
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '';
    
    badge.innerText = "🔥 Sangat Ramai";
    badge.className = "badge green";
    badge.style.background = 'rgba(46, 204, 113, 0.15)';
    badge.style.color = '#2ecc71';

    places.slice(0, 5).forEach(place => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div>
                   <strong style="font-size:0.9rem;">${place.name}</strong><br>
                   <small style="color:var(--text-dim)">📍 ${place.distance}m - ${place.address}</small>
                </div>
                <a href="https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}" target="_blank" style="padding:5px; background:rgba(46,204,113,0.1); border-radius:8px;">🛵</a>
            </div>
        `;
        list.appendChild(div);
    });
}

function showStaticRecommendations() {
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '<div class="recommendation-item">Belum ada data spot spesifik. Standby dekat area kuliner terdekat.</div>';
}

// --- Tracking & Timers ---

function startIdleTimer() {
    const timerEl = document.getElementById('idle-timer');
    const progressEl = document.getElementById('timer-progress');
    setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastMoveTime) / 1000);
        timerEl.innerText = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
        progressEl.setAttribute('stroke-dasharray', `${Math.min((elapsed/(idleLimitMinutes*60))*100, 100)}, 100`);
        if (elapsed >= (idleLimitMinutes * 60) && elapsed % 300 === 0) {
            // Suara/Notifikasi sederhana jika sudah terlalu lama diam
            console.warn("⚠️ Waktunya geser! Sudah " + idleLimitMinutes + " menit diam.");
        }
    }, 1000);
}

function startTracking() {
    navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        initMap(latitude, longitude);
        
        // Update Status Card UI
        document.getElementById('current-zone-title').innerText = "📍 Lokasi Aktif";
        document.getElementById('current-zone-desc').innerText = "Titik GPS Terkunci (Akurasi: " + Math.round(accuracy) + "m)";
        
        if (!lastPosition || getDistance(lastPosition.lat, lastPosition.lng, latitude, longitude) > 30) {
            lastMoveTime = Date.now();
            fetchNearbyHotspots(latitude, longitude);
        }
        lastPosition = { lat: latitude, lng: longitude };
        document.getElementById('connection-status').innerText = `Online (${Math.round(accuracy)}m)`;
    }, (err) => {
        document.getElementById('current-zone-title').innerText = "⚠️ GPS Bermasalah";
        document.getElementById('current-zone-desc').innerText = "Berikan izin lokasi atau nyalakan GPS di pengaturan HP.";
    }, { 
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000
    });
}

// --- Events ---

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetView = btn.dataset.view;
        if (!targetView) return;
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
document.getElementById('setting-idle-time').addEventListener('change', (e) => {
    idleLimitMinutes = parseInt(e.target.value);
    localStorage.setItem('idleLimitMinutes', idleLimitMinutes);
});

document.getElementById('clear-history').addEventListener('click', () => {
    if (confirm("Hapus semua riwayat tanda gacor?")) {
        orderHistory = [];
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
        updateHeatmap();
    }
});

document.getElementById('btn-reset-all').addEventListener('click', () => {
    if (confirm("⚠️ Semua data pendapatan dan riwayat akan dihapus permanen!")) {
        localStorage.clear();
        location.reload();
    }
});

// Kick off
startTracking();
startIdleTimer();
updateStatisticsUI();
