// Initiera databas
const db = new Dexie('GolfDB');
db.version(1).stores({ strokes: '++id, hole_id, club, lat, lng, timestamp' });

// Backa Säteri Koordinater
const COURSE_DATA = [
    { hole_id: 1, par: 4, green: { lat: 57.88229, lng: 12.05949 } },
    { hole_id: 2, par: 4, green: { lat: 57.88219, lng: 12.06214 } },
    { hole_id: 3, par: 5, green: { lat: 57.88426, lng: 12.06456 } },
    { hole_id: 4, par: 3, green: { lat: 57.88414, lng: 12.07223 } },
    { hole_id: 5, par: 4, green: { lat: 57.88585, lng: 12.07172 } },
    { hole_id: 6, par: 3, green: { lat: 57.88372, lng: 12.06990 } },
    { hole_id: 7, par: 4, green: { lat: 57.88246, lng: 12.06830 } },
    { hole_id: 8, par: 3, green: { lat: 57.88372, lng: 12.05739 } },
    { hole_id: 9, par: 4, green: { lat: 57.88383, lng: 12.05445 } }
];

let currentHoleIndex = 0;
let watchId = null;
let wakeLock = null;

// UI-uppdatering
function updateUI() {
    const hole = COURSE_DATA[currentHoleIndex];
    document.getElementById('hole-info').innerText = `Hål ${hole.hole_id} (Par ${hole.par})`;
}

// Navigering
document.getElementById('next-hole').addEventListener('click', () => {
    if (currentHoleIndex < COURSE_DATA.length - 1) { currentHoleIndex++; updateUI(); }
});
document.getElementById('prev-hole').addEventListener('click', () => {
    if (currentHoleIndex > 0) { currentHoleIndex--; updateUI(); }
});

// Haversine distans (returnerar meter)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Geolocation Loop
function startTracking() {
    if (watchId) return;
    const statusEl = document.getElementById('gps-status');
    
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            statusEl.innerText = "GPS Aktiv";
            statusEl.className = "status active";
            const target = COURSE_DATA[currentHoleIndex].green;
            const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, target.lat, target.lng);
            document.getElementById('distance').innerText = Math.round(dist);
        },
        (err) => {
            statusEl.innerText = `GPS Fel: ${err.message}`;
            statusEl.className = "status warning";
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
}

// Logga slag till IndexedDB
async function logStroke(club) {
    navigator.geolocation.getCurrentPosition(async (pos) => {
        await db.strokes.add({
            hole_id: COURSE_DATA[currentHoleIndex].hole_id,
            club: club,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            timestamp: Date.now()
        });
        
        // Visuell feedback
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = "Loggad ✓";
        btn.style.background = "var(--primary)";
        btn.style.color = "#000";
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.background = "var(--surface)";
            btn.style.color = "var(--text)";
        }, 1500);
    }, null, { enableHighAccuracy: true });
}

// Wake Lock API
document.getElementById('start-btn').addEventListener('click', async () => {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        startTracking();
        document.getElementById('start-btn').style.display = 'none';
    } catch (err) { console.error("Wake Lock misslyckades", err); }
});

// Exportera
document.getElementById('export-btn').addEventListener('click', async () => {
    const data = await db.strokes.toArray();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backasateri_runda_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
});

// Initiera
updateUI();
