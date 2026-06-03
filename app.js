const db = new Dexie('GolfDB');
db.version(1).stores({ strokes: '++id, hole_id, club, lat, lng, timestamp' });

const HOLE_1_GREEN = { lat: 57.88229, lng: 12.05949 };

function logStroke(club) {
    navigator.geolocation.getCurrentPosition(async (pos) => {
        await db.strokes.add({
            hole_id: 1,
            club: club,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            timestamp: Date.now()
        });
        alert('Slag loggat!');
    });
}

function updateDistance(pos) {
    const d = calculateDistance(pos.coords.latitude, pos.coords.longitude, HOLE_1_GREEN.lat, HOLE_1_GREEN.lng);
    document.getElementById('distance').innerText = Math.round(d) + ' m';
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function exportData() {
    const data = await db.strokes.toArray();
    const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'runda.json'; a.click();
}

navigator.geolocation.watchPosition(updateDistance, null, {enableHighAccuracy: true});
