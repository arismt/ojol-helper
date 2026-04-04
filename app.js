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
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
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
    if (!lastPosition) return alert("Tunggu GPS akurat dulu!");
    const newOrder = {
        id: Date.now(), lat: lastPosition.lat, lng: lastPosition.lng,
        time: new Date().toLocaleTimeString(), date: getTodayDate()
    };
    orderHistory.push(newOrder);
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
    updateHeatmap();
    alert("🚀 Titik Gacor tersimpan!");
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
    if (isNaN(amount) || amount <= 0) return alert("Masukkan nominal yang benar!");

    const newEarning = {
        id: Date.now(),
        amount: amount,
        time: new Date().toLocaleTimeString(),
        date: getTodayDate()
    };

    earningsHistory.push(newEarning);
    localStorage.setItem('earningsHistory', JSON.stringify(earningsHistory));
    input.value = '';
    updateStatisticsUI();
}

function updateStatisticsUI() {
    const today = getTodayDate();
    const todayEarnings = earningsHistory.filter(e => e.date === today);
    const todayOrders = orderHistory.filter(o => o.date === today).length;
    const totalTodayAmount = todayEarnings.reduce((sum, e) => sum + e.amount, 0);

    // Summary Cards
    document.getElementById('stat-today-orders').innerText = todayOrders;
    document.getElementById('stat-today-earnings').innerText = formatRupiah(totalTodayAmount);
    
    // Earnings List
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
        const dateObj = new Date(day.split('/').reverse().join('-'));
        const dayLabel = index === 6 ? 'H.Ini' : dayNames[new Date().getDay() - (6 - index)] || '...';
        
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

// --- Settings & UI Logic ---

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
    if (confirm("Hapus riwayat titik gacor?")) {
        orderHistory = [];
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
        updateHeatmap();
    }
});

document.getElementById('btn-reset-all').addEventListener('click', () => {
    if (confirm("⚠️ PERINGATAN: Semua data (order, pendapatan, titik gacor) akan dihapus permanen. Lanjutkan?")) {
        localStorage.clear();
        location.reload();
    }
});

// --- API & Map Logic ---

async function fetchWithTimeout(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

async function fetchNearbyHotspots(lat, lng) {
    const now = Date.now();
    if (now - lastFetchTime < FETCH_COOLDOWN_MS) return;
    lastFetchTime = now;
    const badge = document.getElementById('status-badge');
    badge.innerText = "Mencari Spot...";
    hotspots.forEach(h => map.removeLayer(h));
    hotspots = [];
    const query = `[out:json][timeout:10];node(around:1200,${lat},${lng})[amenity~"restaurant|fast_food|cafe|marketplace"];out 15;`;
    const encodedQuery = encodeURIComponent(query);
    let data = null;
    for (const mirror of OVERPASS_MIRRORS) {
        try {
            const response = await fetchWithTimeout(`${mirror}?data=${encodedQuery}`, 10000);
            if (!response.ok) throw new Error();
            data = await response.json();
            break;
        } catch (e) {}
    }
    if (!data) {
        badge.innerText = "Offline";
        showStaticRecommendations();
        return;
    }
    const places = data.elements.map(el => ({
        name: el.tags.name || "Restoran/Food Court",
        address: el.tags['addr:street'] || "Area Sekitar",
        lat: el.lat, lon: el.lon,
        distance: Math.round(getDistance(lat, lng, el.lat, el.lon))
    })).sort((a, b) => a.distance - b.distance);
    places.forEach(place => {
        const spot = L.circle([place.lat, place.lon], { color: '#2ecc71', fillColor: '#2ecc71', fillOpacity: 0.3, radius: 40, weight: 1 }).addTo(map);
        spot.bindPopup(`<b>${place.name}</b><br><small>${place.address}</small><br><a href="https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}" target="_blank">Navigasi 🛵</a>`);
        hotspots.push(spot);
    });
    updateUIRecommendations(places.length > 0 ? places : null);
}

function showStaticRecommendations() {
    const hour = new Date().getHours();
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '';
    const title = document.getElementById('current-zone-title');
    const desc = document.getElementById('current-zone-desc');
    let tips = [];
    if (hour >= 11 && hour <= 14) {
        title.innerText = '🔥 Jam Makan Siang';
        desc.innerText = 'Fokus resto kuliner.';
        tips = ['Pusat kuliner', 'Parkir ±150m resto'];
    } else {
        title.innerText = '🟢 Jam Pantau';
        desc.innerText = 'Standby area ramai.';
        tips = ['Minimarket', 'Jalan utama'];
    }
    tips.forEach(t => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        div.innerHTML = `<span>💡 ${t}</span>`;
        list.appendChild(div);
    });
}

function updateUIRecommendations(places) {
    const badge = document.getElementById('status-badge');
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '';
    if (!places) return;
    badge.innerText = "Sangat Ramai";
    places.slice(0, 4).forEach(place => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        div.innerHTML = `<span><b>${place.name}</b> (${place.distance}m)</span><br><small>📍 ${place.address}</small>`;
        list.appendChild(div);
    });
}

// --- Tracking & Timers ---

function startIdleTimer() {
    const timerEl = document.getElementById('idle-timer');
    const progressEl = document.getElementById('timer-progress');
    setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastMoveTime) / 1000);
        timerEl.innerText = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
        progressEl.setAttribute('stroke-dasharray', `${Math.min((elapsed/(idleLimitMinutes*60))*100, 100)}, 100`);
        if (elapsed >= (idleLimitMinutes * 60) && elapsed % 300 === 0) alert(`⚠️ Sudah ${idleLimitMinutes} menit diam!`);
    }, 1000);
}

function startTracking() {
    navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        initMap(latitude, longitude);
        if (lastPosition && getDistance(lastPosition.lat, lastPosition.lng, latitude, longitude) > 30) {
            lastMoveTime = Date.now();
            fetchNearbyHotspots(latitude, longitude);
        }
        lastPosition = { lat: latitude, lng: longitude };
        document.getElementById('connection-status').innerText = `Online (${Math.round(accuracy)}m)`;
    }, null, { enableHighAccuracy: true });
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2-lat1)*Math.PI/180;
    const dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

startTracking();
startIdleTimer();
updateStatisticsUI(); // Initial stats load
