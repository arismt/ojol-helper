let map;
let marker;
let heatLayer;
let lastPosition = null;
let lastMoveTime = Date.now();
let hotspots = [];
let lastSuccessfulSpots = []; // MEMORY CACHE
let orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
let earningsHistory = JSON.parse(localStorage.getItem('earningsHistory') || '[]');
let idleLimitMinutes = parseInt(localStorage.getItem('idleLimitMinutes') || '10');
let isAlarmActive = localStorage.getItem('isAlarmActive') !== 'false';
let isRaining = false;
let lastAlertTime = Date.now();
let weatherDesc = "Cerah";
let lastWeatherFetch = 0;
const FETCH_COOLDOWN_MS = 15000;
const WEATHER_COOLDOWN_MS = 600000; // 10 Menit

let allVoices = [];
window.speechSynthesis.onvoiceschanged = () => {
    allVoices = window.speechSynthesis.getVoices();
};

const OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

lucide.createIcons();

// Sinkronisasi UI Pengaturan saat Start
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('setting-idle-time').value = idleLimitMinutes;
    document.getElementById('setting-alarm-voice').checked = isAlarmActive;
});

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

// --- Smart Logic (Core) ---

function calculateGacorScore(place, currentHour) {
    let score = 30;
    const type = (place.type || "").toLowerCase();
    const name = (place.name || "").toLowerCase();

    if (type.includes('mall')) score += 50;
    if (type.includes('food_court')) score += 45;
    if (type.includes('fast_food')) score += 40;
    if (type.includes('restaurant')) score += 35;
    if (type.includes('supermarket')) score += 30;
    if (type.includes('convenience') || type.includes('minimarket')) score += 15;

    if (currentHour >= 11 && currentHour <= 14) {
        if (type.includes('restaurant') || type.includes('food_court') || name.includes('ayam') || name.includes('bakmie')) score += 35;
    }
    if (currentHour >= 17 && currentHour <= 21) {
        if (type.includes('fast_food') || type.includes('martabak') || name.includes('sate') || name.includes('malam')) score += 30;
    }
    if (currentHour >= 22 || currentHour <= 3) {
        if (type.includes('convenience') || name.includes('warkop') || name.includes('warmindo')) score += 40;
    }

    if (place.distance < 400) score += 20;
    else if (place.distance > 1800) score -= 30;

    // --- Weather Bonus Logic ---
    if (isRaining) {
        if (type.includes('restaurant') || type.includes('food_court') || type.includes('fast_food')) {
            score += 35; // Orang lebih banyak pesan makanan pas hujan
        }
        if (type.includes('supermarket') || type.includes('convenience') || name.includes('mart')) {
            score += 20; // Belanja harian juga naik
        }
        if (type.includes('mall')) {
            score += 25; // Mall jadi pusat pangkalan & orderan barang
        }
    }

    return Math.min(score, 100);
}

async function fetchWeather(lat, lng) {
    const now = Date.now();
    if (now - lastWeatherFetch < WEATHER_COOLDOWN_MS) return;
    lastWeatherFetch = now;

    try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
        const data = await response.json();
        const code = data.current_weather.weathercode;
        const weatherEl = document.getElementById('weather-info');
        const weatherIcon = document.getElementById('weather-icon');
        const weatherText = document.getElementById('weather-text');

        // WMO Weather interpretation codes
        // 51, 53, 55: Drizzle
        // 61, 63, 65: Rain
        // 80, 81, 82: Rain showers
        if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
            isRaining = true;
            weatherDesc = "Hujan";
            weatherIcon.innerText = "🌧️";
            weatherText.style.color = "#3498db";
        } else {
            isRaining = false;
            weatherDesc = "Cerah";
            weatherIcon.innerText = "☀️";
            weatherText.style.color = "#f1c40f";
        }
        
        weatherText.innerText = weatherDesc;
        weatherEl.style.display = 'flex';
    } catch (e) {
        console.error("Gagal ambil cuaca", e);
    }
}

async function fetchNearbyHotspots(lat, lng) {
    const now = Date.now();
    if (now - lastFetchTime < FETCH_COOLDOWN_MS) return;
    lastFetchTime = now;
    
    // Update cuaca juga
    fetchWeather(lat, lng);
    
    const badge = document.getElementById('status-badge');
    badge.innerText = "🔄 Mengupdate Data...";
    badge.style.background = 'rgba(241, 196, 15, 0.2)';
    badge.style.color = '#f1c40f';

    const query = `[out:json][timeout:15];(nwr(around:2200,${lat},${lng})[amenity~"restaurant|fast_food|cafe|food_court|pharmacy"];nwr(around:2200,${lat},${lng})[shop~"convenience|supermarket|mall|minimarket|department_store"];);out center 50;`;
    const encodedQuery = encodeURIComponent(query);
    
    let data = null;
    let mirrorFound = false;

    for (const mirror of OVERPASS_MIRRORS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            const response = await fetch(`${mirror}?data=${encodedQuery}`, { signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) { data = await response.json(); mirrorFound = true; break; }
        } catch (e) {}
    }

    // MEMORY CACHE LOGIC: Jika gagal, jangan hapus yang ada di layar
    if (!data || !data.elements || data.elements.length === 0) {
        if (lastSuccessfulSpots.length > 0) {
            badge.innerText = "📍 Memori Aktif";
            badge.style.color = "#3498db";
            // Update jarak dari data memori
            lastSuccessfulSpots.forEach(p => {
                p.distance = Math.round(getDistance(lat, lng, p.lat, p.lon));
            });
            updateSmartRecommendations(lastSuccessfulSpots.sort((a,b) => b.gacorScore - a.gacorScore));
        } else {
            badge.innerText = "☕ Standby";
            showStaticRecommendations();
        }
        return;
    }

    const currentHour = new Date().getHours();
    const places = data.elements.map(el => {
        const coords = el.center || { lat: el.lat, lon: el.lon };
        const p = {
            name: el.tags.name || el.tags.shop || el.tags.amenity || "Area Rame",
            type: el.tags.amenity || el.tags.shop || "Point",
            lat: coords.lat, lon: coords.lon,
            distance: Math.round(getDistance(lat, lng, coords.lat, coords.lon))
        };
        p.gacorScore = calculateGacorScore(p, currentHour);
        return p;
    }).sort((a, b) => b.gacorScore - a.gacorScore);

    // Simpan hasil sukses ke memori
    lastSuccessfulSpots = places;

    hotspots.forEach(h => map.removeLayer(h));
    hotspots = [];
    places.slice(0, 15).forEach(place => {
        let color = place.gacorScore > 75 ? '#e74c3c' : (place.gacorScore > 50 ? '#f1c40f' : '#3498db');
        const spot = L.circle([place.lat, place.lon], { color: color, fillColor: color, fillOpacity: 0.3, radius: 60, weight: 1 }).addTo(map);
        spot.bindPopup(`<b>${place.name}</b><br>Gacor: ${place.gacorScore}%`);
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

    places.slice(0, 8).forEach(place => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        let levelColor = '#2ecc71';
        let levelText = "Potensi Sedang";
        if (place.gacorScore > 80) { levelColor = '#e74c3c'; levelText = "🔥 SANGAT GACOR"; }
        else if (place.gacorScore > 55) { levelColor = '#f1c40f'; levelText = "⚠️ Potensi Tinggi"; }

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

function startTracking() {
    navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        initMap(latitude, longitude);
        document.getElementById('current-zone-title').innerText = "📍 Lokasi Aktif";
        // Refresh jika geser > 50 meter
        if (!lastPosition || getDistance(lastPosition.lat, lastPosition.lng, latitude, longitude) > 50) {
            lastMoveTime = Date.now();
            lastAlertTime = Date.now(); // RESET ALERT TIMER JUGA KALO GERAK
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

// Bunyi Bell Digital (Ding-Dong)
function playNotificationSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        function playTone(freq, time, duration) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle'; // Suara lebih halus tapi nyaring
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.5, time + 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, time + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(time);
            osc.stop(time + duration);
        }

        // Bunyi Ding-Dong lebih kencang
        playTone(987.77, audioCtx.currentTime, 0.5); // B5 (Ding)
        playTone(783.99, audioCtx.currentTime + 0.4, 0.6); // G5 (Dong)
    } catch (e) {
        console.error("Gagal putar bell", e);
    }
}

// Asisten Suara Proaktif
function playProactiveVoiceSuggestion() {
    if (!isAlarmActive) return;

    // Bunyikan bell dulu
    playNotificationSound();

    let message = "Bang, sudah " + idleLimitMinutes + " menit diam. ";
    
    if (lastSuccessfulSpots && lastSuccessfulSpots.length > 0) {
        const bestPlace = lastSuccessfulSpots[0]; // Karena sudah di-sort b.gacorScore - a.gacorScore
        message += "Coba geser ke " + bestPlace.name + " yuk, potensi gacor " + bestPlace.gacorScore + " persen!";
    } else {
        message += "Jangan kelamaan nongkrong, yuk cari titik yang lebih ramai!";
    }

    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(message);
    
    // Cari suara Indonesia
    const idVoice = allVoices.find(v => v.lang.includes('id') || v.lang.includes('ID'));
    if (idVoice) {
        speech.voice = idVoice;
        speech.lang = idVoice.lang;
    } else {
        speech.lang = 'id-ID';
    }

    speech.rate = 0.9;
    window.speechSynthesis.speak(speech);

    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function startIdleTimer() {
    setInterval(() => {
        const now = Date.now();
        const totalElapsed = Math.floor((now - lastMoveTime) / 1000);
        const elapsedSinceAlert = Math.floor((now - lastAlertTime) / 1000);
        const limitSeconds = idleLimitMinutes * 60;
        
        // Tampilan Timer yang looping (Reset ke 0)
        let displaySeconds = elapsedSinceAlert;
        if (displaySeconds >= limitSeconds) {
            // Kita biarkan sedikit lewat (misal 1 detik) biar keliatan pas di titik nolnya
            // tapi asisten akan mereset lastAlertTime nanti
        }

        document.getElementById('idle-timer').innerText = `${String(Math.floor(displaySeconds/60)).padStart(2,'0')}:${String(displaySeconds%60).padStart(2,'0')}`;
        
        // Tampilkan Total Diam di bawahnya (biar abang gak lupa waktu total)
        document.getElementById('total-idle-time').innerText = `Total: ${String(Math.floor(totalElapsed/60)).padStart(2,'0')}:${String(totalElapsed%60).padStart(2,'0')}`;

        // Update visual progress di lingkaran
        const progress = Math.min((elapsedSinceAlert / limitSeconds) * 100, 100);
        document.getElementById('timer-progress').style.strokeDasharray = `${progress}, 100`;

        // Trigger Alert & Reset loop
        if (elapsedSinceAlert >= limitSeconds) { 
            console.log("Triggering Loop Alert & Resetting Visual Timer");
            playProactiveVoiceSuggestion(); 
            lastAlertTime = now; // RESET VISUAL KE 0
        }
        
    }, 1000);
}

// --- Menu Handlers ---
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

document.getElementById('status-badge').addEventListener('click', () => {
    if (lastPosition) { lastFetchTime = 0; fetchNearbyHotspots(lastPosition.lat, lastPosition.lng); }
});

document.getElementById('log-order-btn').addEventListener('click', () => {
    if (!lastPosition) return alert("🛰️ Tunggu GPS!");
    orderHistory.push({ id: Date.now(), lat: lastPosition.lat, lng: lastPosition.lng, time: new Date().toLocaleTimeString(), date: new Date().toLocaleDateString('id-ID') });
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
    updateHeatmap();
    alert("🚀 Titik Gacor tersimpan!");
});

// --- Settings Handlers ---
document.getElementById('setting-idle-time').addEventListener('change', (e) => {
    idleLimitMinutes = parseInt(e.target.value);
    localStorage.setItem('idleLimitMinutes', idleLimitMinutes);
    alert(`Konfigurasi tersimpan: Alert setiap ${idleLimitMinutes} menit.`);
});

document.getElementById('setting-alarm-voice').addEventListener('change', (e) => {
    isAlarmActive = e.target.checked;
    localStorage.setItem('isAlarmActive', isAlarmActive);
});

document.getElementById('btn-test-voice').addEventListener('click', function() {
    // Efek Visual Tombol
    const btn = this;
    const originalText = btn.innerText;
    btn.style.borderColor = "#2ecc71";
    btn.innerText = "📢 Memutar Suara...";
    setTimeout(() => { btn.innerText = originalText; btn.style.borderColor = "var(--primary-color)"; }, 3000);

    // Langsung bunyikan bell (Harus dipanggil di paling atas listener)
    playNotificationSound();
    
    if (!window.speechSynthesis) {
        return alert("❌ Browser Abang tidak mendukung suara (SpeechSynthesis). Coba gunakan Chrome terbaru.");
    }

    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance("Tes suara asisten Ojol Helper. Harusnya ada bunyi lonceng Ding-Dong tadi sebelum saya bicara.");
    
    const idVoice = allVoices.find(v => v.lang.includes('id') || v.lang.includes('ID'));
    if (idVoice) {
        speech.voice = idVoice;
        speech.lang = idVoice.lang;
    } else {
        speech.lang = 'id-ID';
    }

    speech.onerror = (event) => {
        alert("❌ Error Suara: " + event.error + ". Coba cek volume Media di HP Abang.");
    };

    window.speechSynthesis.speak(speech);
    
    if (navigator.vibrate) {
        navigator.vibrate(200);
    } else {
        console.warn("Vibration API not supported");
    }
});

document.getElementById('btn-reset-all').addEventListener('click', () => {
    if (confirm("Hapus semua data riwayat dan pengaturan?")) {
        localStorage.clear();
        location.reload();
    }
});

function updateHeatmap() {
    if (heatLayer && map) map.removeLayer(heatLayer);
    if (!map) return;
    const heatData = orderHistory.map(o => [o.lat, o.lng, 0.5]);
    heatLayer = L.heatLayer(heatData, { radius: 35, blur: 15, maxZoom: 17 }).addTo(map);
}

function showStaticRecommendations() {
    document.getElementById('recommendation-list').innerHTML = '<div class="recommendation-item">Belum ada spot terdekat. Cobalah geser ke jalan utama yang lebih ramai.</div>';
}

startTracking();
startIdleTimer();
updateHeatmap();
function formatRupiah(n){return "Rp "+n.toLocaleString("id-ID")}
