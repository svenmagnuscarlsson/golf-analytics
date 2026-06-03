// Initiera databas med schema-versioner och migrationer
const db = new Dexie('GolfDB');

// Version 1 (ursprunglig)
db.version(1).stores({ strokes: '++id, hole_id, club, lat, lng, timestamp' });

// Version 2: Lägg till rounds och gruppera slag via round_id
db.version(2).stores({
    rounds: '++id, startTime, endTime',
    strokes: '++id, round_id, hole_id, club, lat, lng, timestamp'
}).upgrade(async tx => {
    const strokesTable = tx.table('strokes');
    const roundsTable = tx.table('rounds');

    const strokes = await strokesTable.toArray();
    if (strokes.length === 0) return;

    // Sortera slagen efter tidsstämpel
    strokes.sort((a, b) => a.timestamp - b.timestamp);

    let currentRoundId = null;
    let lastTimestamp = 0;

    for (const stroke of strokes) {
        if (stroke.round_id) continue;

        const timeDiff = stroke.timestamp - lastTimestamp;
        // Om det gått mer än 5 timmar sedan förra slaget, skapa ny runda
        if (currentRoundId === null || timeDiff > 5 * 60 * 60 * 1000) {
            currentRoundId = await roundsTable.add({
                startTime: stroke.timestamp,
                endTime: stroke.timestamp
            });
        }

        stroke.round_id = currentRoundId;
        await strokesTable.put(stroke);
        await roundsTable.update(currentRoundId, { endTime: stroke.timestamp });
        lastTimestamp = stroke.timestamp;
    }
});

// Version 3: Lägg till settings för hcp och tee-val
db.version(3).stores({
    rounds: '++id, startTime, endTime',
    strokes: '++id, round_id, hole_id, club, lat, lng, timestamp',
    settings: 'key'
});

// Globala inställningar och data
let userHcp = '36.0';
let userTee = 'Gul';
let slopetable = null;

// Hämta inställning från IndexedDB
async function getSetting(key, defaultValue) {
    try {
        const item = await db.settings.get(key);
        return item ? item.value : defaultValue;
    } catch (e) {
        console.warn("Kunde inte hämta inställning", key, e);
        return defaultValue;
    }
}

// Spara inställning till IndexedDB
async function saveSetting(key, value) {
    try {
        await db.settings.put({ key, value });
    } catch (e) {
        console.error("Kunde inte spara inställning", key, value, e);
    }
}

// Ladda inställningar och slopetabell på startup
async function initSettings() {
    userHcp = await getSetting('hcp', '36.0');
    userTee = await getSetting('tee', 'Gul');

    try {
        const response = await fetch('slopetable-backa-sateri.json');
        slopetable = await response.json();
    } catch (e) {
        console.error("Kunde inte ladda slopetabell-filen", e);
    }
}

// Stableford-beräkningsfunktioner
function parseHcpString(hcpStr) {
    if (hcpStr === undefined || hcpStr === null) return 0;
    let s = hcpStr.toString().trim();
    if (s.startsWith('+')) {
        return -parseFloat(s.slice(1));
    }
    return parseFloat(s);
}

function getSpelhcp(tee, hcpVal) {
    if (!slopetable || !slopetable.slopetabell) return 0;
    const teeData = slopetable.slopetabell[tee];
    if (!teeData) return 0;

    const h = Math.round(parseHcpString(hcpVal) * 10) / 10;
    const intervals = teeData.handicapIntervaller;

    const parsedIntervals = intervals.map(i => ({
        min: parseHcpString(i.handicapMin),
        max: parseHcpString(i.handicapMax),
        spelhcp: i.spelhcp
    }));

    parsedIntervals.sort((a, b) => a.min - b.min);

    const absoluteMin = parsedIntervals[0].min;
    const absoluteMax = parsedIntervals[parsedIntervals.length - 1].max;

    if (h < absoluteMin) return parsedIntervals[0].spelhcp;
    if (h > absoluteMax) return parsedIntervals[parsedIntervals.length - 1].spelhcp;

    const match = parsedIntervals.find(i => h >= i.min && h <= i.max);
    return match ? match.spelhcp : 0;
}

function getHandicapStrokesForHole(holeId, spelhcp9) {
    const HOLE_INDEXES = {
        1: 3,
        2: 9,
        3: 11,
        4: 13,
        5: 7,
        6: 15,
        7: 5,
        8: 17,
        9: 1
    };

    const index = HOLE_INDEXES[holeId];
    if (index === undefined) return 0;

    if (spelhcp9 >= 0) {
        const baseStrokes = Math.floor(spelhcp9 / 9);
        const remStrokes = spelhcp9 % 9;
        const sortedIndexes = [1, 3, 5, 7, 9, 11, 13, 15, 17];
        if (remStrokes > 0) {
            const threshold = sortedIndexes[remStrokes - 1];
            if (index <= threshold) {
                return baseStrokes + 1;
            }
        }
        return baseStrokes;
    } else {
        const absSpelhcp = Math.abs(spelhcp9);
        const baseStrokes = Math.floor(absSpelhcp / 9);
        const remStrokes = absSpelhcp % 9;
        const sortedEasiest = [17, 15, 13, 11, 9, 7, 5, 3, 1];
        let deduction = baseStrokes;
        if (remStrokes > 0) {
            const threshold = sortedEasiest[remStrokes - 1];
            if (index >= threshold) {
                deduction += 1;
            }
        }
        return -deduction;
    }
}

function calculateStablefordPoints(strokes, par, handicapStrokes) {
    if (strokes <= 0) return 0;
    const netStrokes = strokes - handicapStrokes;
    return Math.max(0, par - netStrokes + 2);
}


// Backa Säteri Koordinater
const COURSE_DATA = [
    { "hole_id": 1, "par": 4, "tee_yellow": { "lat": 57.88386, "lng": 12.05461 }, "green": { "lat": 57.88229, "lng": 12.05949 } },
    { "hole_id": 2, "par": 4, "tee_yellow": { "lat": 57.88138, "lng": 12.06089 }, "green": { "lat": 57.88219, "lng": 12.06214 } },
    { "hole_id": 3, "par": 5, "tee_yellow": { "lat": 57.88244, "lng": 12.06222 }, "green": { "lat": 57.88426, "lng": 12.06456 } },
    { "hole_id": 4, "par": 3, "tee_yellow": { "lat": 57.88452, "lng": 12.06487 }, "green": { "lat": 57.88414, "lng": 12.07223 } },
    { "hole_id": 5, "par": 4, "tee_yellow": { "lat": 57.88416, "lng": 12.07248 }, "green": { "lat": 57.88585, "lng": 12.07172 } },
    { "hole_id": 6, "par": 3, "tee_yellow": { "lat": 57.88605, "lng": 12.07173 }, "green": { "lat": 57.88372, "lng": 12.06990 } },
    { "hole_id": 7, "par": 4, "tee_yellow": { "lat": 57.88358, "lng": 12.06967 }, "green": { "lat": 57.88246, "lng": 12.06830 } },
    { "hole_id": 8, "par": 3, "tee_yellow": { "lat": 57.88173, "lng": 12.06041 }, "green": { "lat": 57.88372, "lng": 12.05739 } },
    { "hole_id": 9, "par": 4, "tee_yellow": { "lat": 57.88359, "lng": 12.05777 }, "green": { "lat": 57.88383, "lng": 12.05445 } }
];

let currentRoundId = localStorage.getItem('currentRoundId') ? parseInt(localStorage.getItem('currentRoundId')) : null;
let currentHoleIndex = localStorage.getItem('currentHoleIndex') ? parseInt(localStorage.getItem('currentHoleIndex')) : 0;
let watchId = null;
let wakeLock = null;

// UI-uppdatering för spelskärmen
function updateUI() {
    const hole = COURSE_DATA[currentHoleIndex];
    document.getElementById('hole-info').innerText = `Hål ${hole.hole_id} (Par ${hole.par})`;

    const startBtn = document.getElementById('start-btn');
    const endBtn = document.getElementById('end-btn');
    const clubBtns = document.querySelectorAll('.club-btn');

    if (currentRoundId) {
        startBtn.style.display = 'none';
        endBtn.style.display = 'block';
        clubBtns.forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('disabled');
        });
    } else {
        startBtn.style.display = 'block';
        endBtn.style.display = 'none';
        clubBtns.forEach(btn => {
            btn.disabled = true;
            btn.classList.add('disabled');
        });
        document.getElementById('distance').innerText = '--';
    }
}

// Navigering mellan hål
document.getElementById('next-hole').addEventListener('click', () => {
    if (currentHoleIndex < COURSE_DATA.length - 1) {
        currentHoleIndex++;
        localStorage.setItem('currentHoleIndex', currentHoleIndex);
        updateUI();
        triggerImmediateGPSUpdate();
    }
});

document.getElementById('prev-hole').addEventListener('click', () => {
    if (currentHoleIndex > 0) {
        currentHoleIndex--;
        localStorage.setItem('currentHoleIndex', currentHoleIndex);
        updateUI();
        triggerImmediateGPSUpdate();
    }
});

function triggerImmediateGPSUpdate() {
    if (watchId) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const target = COURSE_DATA[currentHoleIndex].green;
            const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, target.lat, target.lng);
            document.getElementById('distance').innerText = Math.round(dist);
        }, null, { enableHighAccuracy: true });
    }
}

// Haversine distans (returnerar meter)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Geolocation Loop
function startTracking() {
    if (watchId) return;
    const statusEl = document.getElementById('gps-status');
    statusEl.innerText = "Söker GPS...";
    statusEl.className = "status warning";

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

function stopTracking() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    const statusEl = document.getElementById('gps-status');
    statusEl.innerText = "GPS Inaktiv";
    statusEl.className = "status warning";
}

// Sub-klubbor för respektive kategori
const CLUB_SUB_CATEGORIES = {
    'Wood/Hybrid': ['3-Wood', '5-Wood', 'Hybrid'],
    'Järn Lång': ['J3', 'J4', 'J5', 'J6'],
    'Järn Kort': ['J7', 'J8', 'J9'],
    'Wedge': ['PW', 'GW', 'SW', 'LW']
};

// Hantera klick på klubbkategori
function handleClubClick(category) {
    if (!currentRoundId) {
        alert("Starta en runda först!");
        return;
    }

    const sourceBtn = window.event ? (window.event.currentTarget || window.event.target) : null;

    if (CLUB_SUB_CATEGORIES[category]) {
        showClubSelectModal(category, sourceBtn);
    } else {
        logStroke(category, sourceBtn);
    }
}

// Visa modal för val av specifik klubba
function showClubSelectModal(category, sourceBtn) {
    const modal = document.getElementById('club-select-modal');
    const titleEl = document.getElementById('club-modal-title');
    const gridEl = document.getElementById('club-select-grid');
    const cancelBtn = document.getElementById('club-modal-cancel-btn');

    titleEl.innerText = `Välj ${category}`;
    gridEl.innerHTML = '';

    const subClubs = CLUB_SUB_CATEGORIES[category];
    subClubs.forEach(club => {
        const btn = document.createElement('button');
        btn.innerText = club;
        btn.addEventListener('click', () => {
            closeClubSelectModal();
            logStroke(club, sourceBtn);
        });
        gridEl.appendChild(btn);
    });

    modal.style.display = 'flex';

    const handleOutsideClick = (e) => {
        if (e.target === modal) {
            closeClubSelectModal();
        }
    };
    modal.addEventListener('click', handleOutsideClick);

    const handleCancel = () => {
        closeClubSelectModal();
    };
    cancelBtn.addEventListener('click', handleCancel);

    modal._cleanup = () => {
        modal.removeEventListener('click', handleOutsideClick);
        cancelBtn.removeEventListener('click', handleCancel);
    };
}

function closeClubSelectModal() {
    const modal = document.getElementById('club-select-modal');
    modal.style.display = 'none';
    if (modal._cleanup) {
        modal._cleanup();
        modal._cleanup = null;
    }
}

// Logga slag till IndexedDB
async function logStroke(club, sourceBtn = null) {
    if (!currentRoundId) {
        alert("Starta en runda först!");
        return;
    }

    const btn = sourceBtn || (window.event && (window.event.currentTarget || window.event.target));
    const originalText = btn ? btn.innerText : club;

    if (btn) {
        btn.innerText = "Lokaliserar...";
        btn.disabled = true;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
        await db.strokes.add({
            round_id: currentRoundId,
            hole_id: COURSE_DATA[currentHoleIndex].hole_id,
            club: club,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            timestamp: Date.now()
        });

        // Uppdatera rundans sluttid vid varje nytt slag
        await db.rounds.update(currentRoundId, { endTime: Date.now() });

        // Visuell feedback
        if (btn) {
            btn.innerText = `${club} Loggad ✓`;
            btn.style.background = "var(--primary)";
            btn.style.color = "#000";
            setTimeout(() => {
                btn.innerText = originalText;
                btn.style.background = "";
                btn.style.color = "";
                btn.disabled = false;
            }, 1500);
        }
    }, (err) => {
        alert(`Kunde inte logga slag på grund av GPS-fel: ${err.message}`);
        if (btn) {
            btn.innerText = originalText;
            btn.style.background = "";
            btn.style.color = "";
            btn.disabled = false;
        }
    }, { enableHighAccuracy: true, timeout: 8000 });
}

// Starta runda
document.getElementById('start-btn').addEventListener('click', async () => {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn("Wake Lock misslyckades", err);
    }

    try {
        currentRoundId = await db.rounds.add({
            startTime: Date.now(),
            endTime: Date.now()
        });
        localStorage.setItem('currentRoundId', currentRoundId);

        currentHoleIndex = 0;
        localStorage.setItem('currentHoleIndex', currentHoleIndex);

        startTracking();
        updateUI();
    } catch (err) {
        console.error("Kunde inte starta runda", err);
        alert("Kunde inte starta runda i databasen.");
    }
});

// Avsluta runda
document.getElementById('end-btn').addEventListener('click', async () => {
    const confirmed = await showConfirm({
        title: "Avsluta runda?",
        message: "Är du säker på att du vill avsluta den här rundan?",
        confirmText: "Ja, avsluta",
        cancelText: "Avbryt",
        isDanger: false
    });
    if (!confirmed) return;

    try {
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (e) {
        console.warn(e);
    }

    if (currentRoundId) {
        await db.rounds.update(currentRoundId, { endTime: Date.now() });
    }

    stopTracking();
    currentRoundId = null;
    localStorage.removeItem('currentRoundId');
    localStorage.removeItem('currentHoleIndex');

    updateUI();

    // Gå direkt till historikfliken och visa den nya rundan
    switchTab('history');
});

// Flikhantering (Tab Switching)
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (tabName === 'play') {
        document.getElementById('play-screen').classList.add('active');
        document.getElementById('nav-play').classList.add('active');
    } else if (tabName === 'history') {
        document.getElementById('history-screen').classList.add('active');
        document.getElementById('nav-history').classList.add('active');
        showRoundsList();
        loadHistory();
    } else if (tabName === 'settings') {
        document.getElementById('settings-screen').classList.add('active');
        document.getElementById('nav-settings').classList.add('active');
        loadSettingsToUI();
    }
}

document.getElementById('nav-play').addEventListener('click', () => switchTab('play'));
document.getElementById('nav-history').addEventListener('click', () => switchTab('history'));
document.getElementById('nav-settings').addEventListener('click', () => switchTab('settings'));

// Vy-hantering inom Historik-fliken
function showRoundsList() {
    document.getElementById('rounds-list-view').style.display = 'block';
    document.getElementById('round-detail-view').style.display = 'none';
}

function showRoundDetail() {
    document.getElementById('rounds-list-view').style.display = 'none';
    document.getElementById('round-detail-view').style.display = 'block';
}

document.getElementById('back-to-list-btn').addEventListener('click', showRoundsList);

// Ladda inställningar i UI:t
function loadSettingsToUI() {
    document.getElementById('hcp-input').value = userHcp;

    document.querySelectorAll('.tee-opt-btn').forEach(btn => {
        if (btn.getAttribute('data-tee') === userTee) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Koppla händelselyssnare för Inställningar
function bindSettingsEvents() {
    const hcpInput = document.getElementById('hcp-input');

    document.getElementById('hcp-dec-btn').addEventListener('click', () => {
        let val = parseHcpString(hcpInput.value);
        val = (Math.round(val * 10) - 1) / 10;
        hcpInput.value = val < 0 ? `+${Math.abs(val).toFixed(1)}` : val.toFixed(1);
    });

    document.getElementById('hcp-inc-btn').addEventListener('click', () => {
        let val = parseHcpString(hcpInput.value);
        val = (Math.round(val * 10) + 1) / 10;
        hcpInput.value = val < 0 ? `+${Math.abs(val).toFixed(1)}` : val.toFixed(1);
    });

    document.querySelectorAll('.tee-opt-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tee-opt-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
        });
    });

    document.getElementById('save-settings-btn').addEventListener('click', async () => {
        const rawHcp = hcpInput.value.trim();
        const parsedVal = parseHcpString(rawHcp);
        if (isNaN(parsedVal)) {
            alert("Vänligen ange ett giltigt handikapp (t.ex. 21.4 eller +1.5)");
            return;
        }

        let teeVal = 'Gul';
        const activeTeeBtn = document.querySelector('.tee-opt-btn.active');
        if (activeTeeBtn) {
            teeVal = activeTeeBtn.getAttribute('data-tee');
        }

        const cleanHcpStr = rawHcp.startsWith('+') || parsedVal < 0
            ? `+${Math.abs(parsedVal).toFixed(1)}`
            : parsedVal.toFixed(1);

        await saveSetting('hcp', cleanHcpStr);
        await saveSetting('tee', teeVal);

        userHcp = cleanHcpStr;
        userTee = teeVal;

        const feedback = document.getElementById('settings-saved-feedback');
        feedback.style.display = 'block';
        setTimeout(() => {
            feedback.style.display = 'none';
        }, 1500);
    });
}

// Beräkna totala poäng för en runda
function calculateRoundPoints(strokes, spelhcp9) {
    if (strokes.length === 0) return 0;

    const strokesByHole = {};
    strokes.forEach(s => {
        if (!strokesByHole[s.hole_id]) strokesByHole[s.hole_id] = 0;
        strokesByHole[s.hole_id]++;
    });

    let totalPoints = 0;
    COURSE_DATA.forEach(hole => {
        const score = strokesByHole[hole.hole_id] || 0;
        if (score > 0) {
            const hcpStrokes = getHandicapStrokesForHole(hole.hole_id, spelhcp9);
            const points = calculateStablefordPoints(score, hole.par, hcpStrokes);
            totalPoints += points;
        }
    });
    return totalPoints;
}

// Ladda rundhistorik
async function loadHistory() {
    const roundsList = document.getElementById('rounds-list');
    roundsList.innerHTML = '';

    const rounds = await db.rounds.reverse().toArray();

    if (rounds.length === 0) {
        roundsList.innerHTML = `
            <div class="empty-state">
                <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M8 12h8"></path>
                    <path d="M12 8v8"></path>
                </svg>
                <p>Inga sparade rundor än.</p>
                <button class="primary" onclick="switchTab('play')">Starta en runda</button>
            </div>
        `;
        return;
    }

    const spelhcp18 = getSpelhcp(userTee, userHcp);
    const spelhcp9 = Math.round(spelhcp18 / 2);

    for (const round of rounds) {
        const strokes = await db.strokes.where('round_id').equals(round.id).toArray();
        const strokeCount = strokes.length;

        const strokesByHole = {};
        strokes.forEach(s => {
            if (!strokesByHole[s.hole_id]) strokesByHole[s.hole_id] = 0;
            strokesByHole[s.hole_id]++;
        });

        let totalPar = 0;
        let playedHolesCount = 0;
        Object.keys(strokesByHole).forEach(holeIdStr => {
            const holeId = parseInt(holeIdStr);
            const holeInfo = COURSE_DATA.find(h => h.hole_id === holeId);
            if (holeInfo) {
                totalPar += holeInfo.par;
                playedHolesCount++;
            }
        });

        const diff = strokeCount - totalPar;
        let diffText = "";
        let diffClass = "";

        if (strokeCount === 0) {
            diffText = "0 slag";
            diffClass = "diff-neutral";
        } else {
            if (diff === 0) {
                diffText = "E (Par)";
                diffClass = "diff-par";
            } else if (diff > 0) {
                diffText = `+${diff}`;
                diffClass = "diff-over";
            } else {
                diffText = `${diff}`;
                diffClass = "diff-under";
            }
        }

        const dateStr = new Date(round.startTime).toLocaleDateString('sv-SE', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });

        const durationMs = round.endTime - round.startTime;
        const durationText = formatDuration(durationMs);

        const totalPoints = calculateRoundPoints(strokes, spelhcp9);

        const card = document.createElement('div');
        card.className = 'round-card';
        card.innerHTML = `
            <div class="round-card-info">
                <div class="round-card-date">${dateStr}</div>
                <div class="round-card-sub">${playedHolesCount} hål • ${durationText}</div>
            </div>
            <div class="round-card-score">
                <div class="score-number">${strokeCount} slag • ${totalPoints} p</div>
                <div class="score-diff ${diffClass}">${diffText}</div>
            </div>
        `;

        card.addEventListener('click', () => viewRoundDetails(round.id));
        roundsList.appendChild(card);
    }
}

function formatDuration(ms) {
    if (ms < 60000) return "Mindre än 1 min";
    const minutes = Math.floor(ms / 60000);
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs > 0) {
        return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
}

// Visa runda-detaljer
async function viewRoundDetails(roundId) {
    const round = await db.rounds.get(roundId);
    if (!round) return;

    const strokes = await db.strokes.where('round_id').equals(roundId).toArray();
    strokes.sort((a, b) => a.timestamp - b.timestamp);

    const dateStr = new Date(round.startTime).toLocaleDateString('sv-SE', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    document.getElementById('detail-round-title').innerText = `Runda ${new Date(round.startTime).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}`;
    document.getElementById('detail-date').innerText = dateStr;
    document.getElementById('detail-duration').innerText = formatDuration(round.endTime - round.startTime);

    const strokesByHole = {};
    COURSE_DATA.forEach(h => strokesByHole[h.hole_id] = 0);
    strokes.forEach(s => {
        if (strokesByHole[s.hole_id] !== undefined) {
            strokesByHole[s.hole_id]++;
        }
    });

    let totalStrokes = 0;
    let totalPar = 0;

    const headerRow = document.getElementById('scorecard-header');
    const parRow = document.getElementById('scorecard-par');
    const strokesRow = document.getElementById('scorecard-strokes');
    const diffRow = document.getElementById('scorecard-diff');
    const pointsRow = document.getElementById('scorecard-points');

    headerRow.innerHTML = '<th>Hål</th>';
    parRow.innerHTML = '<td>Par</td>';
    strokesRow.innerHTML = '<td>Slag</td>';
    diffRow.innerHTML = '<td>+/-</td>';
    pointsRow.innerHTML = '<td>Poäng</td>';

    const spelhcp18 = getSpelhcp(userTee, userHcp);
    const spelhcp9 = Math.round(spelhcp18 / 2);

    COURSE_DATA.forEach(hole => {
        const score = strokesByHole[hole.hole_id];
        totalPar += hole.par;
        totalStrokes += score;

        const th = document.createElement('th');
        th.innerText = hole.hole_id;
        headerRow.appendChild(th);

        const tdPar = document.createElement('td');
        tdPar.innerText = hole.par;
        parRow.appendChild(tdPar);

        const tdStrokes = document.createElement('td');
        tdStrokes.innerText = score > 0 ? score : '-';
        strokesRow.appendChild(tdStrokes);

        const tdDiff = document.createElement('td');
        const tdPoints = document.createElement('td');

        if (score > 0) {
            const d = score - hole.par;
            if (d === 0) {
                tdDiff.innerText = 'E';
                tdDiff.className = 'cell-par';
            } else if (d > 0) {
                tdDiff.innerText = `+${d}`;
                tdDiff.className = d === 1 ? 'cell-bogey' : 'cell-double-bogey';
            } else {
                tdDiff.innerText = `${d}`;
                tdDiff.className = d === -1 ? 'cell-birdie' : 'cell-eagle';
            }

            const hcpStrokes = getHandicapStrokesForHole(hole.hole_id, spelhcp9);
            const points = calculateStablefordPoints(score, hole.par, hcpStrokes);
            tdPoints.innerText = points;

            if (points === 0) {
                tdPoints.className = 'cell-double-bogey';
            } else if (points === 1) {
                tdPoints.className = 'cell-bogey';
            } else if (points === 2) {
                tdPoints.className = 'cell-par';
            } else if (points === 3) {
                tdPoints.className = 'cell-birdie';
            } else {
                tdPoints.className = 'cell-eagle';
            }
        } else {
            tdDiff.innerText = '-';
            tdPoints.innerText = '-';
        }
        diffRow.appendChild(tdDiff);
        pointsRow.appendChild(tdPoints);
    });

    // Totals
    const thTot = document.createElement('th');
    thTot.innerText = 'Tot';
    headerRow.appendChild(thTot);

    const tdParTot = document.createElement('td');
    tdParTot.innerText = totalPar;
    tdParTot.className = 'tot-cell';
    parRow.appendChild(tdParTot);

    const tdStrokesTot = document.createElement('td');
    tdStrokesTot.innerText = totalStrokes;
    tdStrokesTot.className = 'tot-cell';
    strokesRow.appendChild(tdStrokesTot);

    const tdDiffTot = document.createElement('td');
    const totalDiff = totalStrokes - totalPar;
    if (totalDiff === 0) {
        tdDiffTot.innerText = 'E';
        tdDiffTot.className = 'tot-cell cell-par';
    } else if (totalDiff > 0) {
        tdDiffTot.innerText = `+${totalDiff}`;
        tdDiffTot.className = 'tot-cell cell-bogey';
    } else {
        tdDiffTot.innerText = `${totalDiff}`;
        tdDiffTot.className = 'tot-cell cell-birdie';
    }
    diffRow.appendChild(tdDiffTot);

    const tdPointsTot = document.createElement('td');
    const totalPoints = calculateRoundPoints(strokes, spelhcp9);
    tdPointsTot.innerText = totalPoints;
    tdPointsTot.className = 'tot-cell';
    pointsRow.appendChild(tdPointsTot);

    document.getElementById('detail-score').innerText = `${totalStrokes} (${totalDiff >= 0 ? '+' : ''}${totalDiff})`;
    document.getElementById('detail-points').innerText = `${totalPoints} p`;

    // Hålanalys
    const breakdownEl = document.getElementById('detail-hole-breakdown');
    breakdownEl.innerHTML = '';

    const strokesGroupedByHole = {};
    strokes.forEach(s => {
        if (!strokesGroupedByHole[s.hole_id]) strokesGroupedByHole[s.hole_id] = [];
        strokesGroupedByHole[s.hole_id].push(s);
    });

    COURSE_DATA.forEach(hole => {
        const holeStrokes = strokesGroupedByHole[hole.hole_id] || [];
        if (holeStrokes.length === 0) return;

        const holeCard = document.createElement('div');
        holeCard.className = 'hole-detail-card';

        const score = holeStrokes.length;
        const diff = score - hole.par;
        let scoreBadgeClass = "";
        let scoreBadgeText = "";

        if (diff === 0) { scoreBadgeClass = 'badge-par'; scoreBadgeText = 'Par'; }
        else if (diff === -1) { scoreBadgeClass = 'badge-birdie'; scoreBadgeText = 'Birdie'; }
        else if (diff < -1) { scoreBadgeClass = 'badge-eagle'; scoreBadgeText = 'Eagle'; }
        else if (diff === 1) { scoreBadgeClass = 'badge-bogey'; scoreBadgeText = 'Bogey'; }
        else { scoreBadgeClass = 'badge-double-bogey'; scoreBadgeText = `+${diff}`; }

        holeCard.innerHTML = `
            <div class="hole-detail-header" onclick="this.parentElement.classList.toggle('expanded')">
                <span class="hole-detail-title">Hål ${hole.hole_id} (Par ${hole.par})</span>
                <div class="hole-detail-header-right">
                    <span class="score-badge ${scoreBadgeClass}">${score} (${scoreBadgeText})</span>
                    <span class="expand-arrow">▼</span>
                </div>
            </div>
            <div class="hole-strokes-list">
                <!-- Slag fylls på nedan -->
            </div>
        `;

        const strokesListEl = holeCard.querySelector('.hole-strokes-list');

        for (let i = 0; i < holeStrokes.length; i++) {
            const stroke = holeStrokes[i];
            let distText = "";

            if (i < holeStrokes.length - 1) {
                const nextStroke = holeStrokes[i + 1];
                const dist = calculateDistance(stroke.lat, stroke.lng, nextStroke.lat, nextStroke.lng);
                distText = `→ ${Math.round(dist)}m`;
            } else {
                const distToGreen = calculateDistance(stroke.lat, stroke.lng, hole.green.lat, hole.green.lng);
                if (stroke.club === 'Putter') {
                    distText = `→ I hål (${Math.round(distToGreen)}m putt)`;
                } else {
                    distText = `→ Green (${Math.round(distToGreen)}m till center)`;
                }
            }

            const strokeItem = document.createElement('div');
            strokeItem.className = 'stroke-item';
            strokeItem.innerHTML = `
                <span class="stroke-index">Slag ${i + 1}</span>
                <span class="stroke-club">${stroke.club}</span>
                <span class="stroke-dist">${distText}</span>
            `;
            strokesListEl.appendChild(strokeItem);
        }

        breakdownEl.appendChild(holeCard);
    });

    // Klona knappar för att ta bort tidigare listeners
    const exportBtn = document.getElementById('detail-export-btn');
    const deleteBtn = document.getElementById('detail-delete-btn');

    const newExportBtn = exportBtn.cloneNode(true);
    const newDeleteBtn = deleteBtn.cloneNode(true);

    exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
    deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);

    newExportBtn.addEventListener('click', () => exportSingleRound(roundId));
    newDeleteBtn.addEventListener('click', () => deleteRound(roundId));

    showRoundDetail();
}

async function exportSingleRound(roundId) {
    const round = await db.rounds.get(roundId);
    if (!round) return;
    const strokes = await db.strokes.where('round_id').equals(roundId).toArray();

    const exportData = {
        round: round,
        strokes: strokes
    };

    const dateFormatted = new Date(round.startTime).toISOString().split('T')[0];
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backasateri_runda_${dateFormatted}.json`;
    a.click();
}

// Anpassad bekräftelsedialog
function showConfirm({ title, message, confirmText = "OK", cancelText = "Avbryt", isDanger = true }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('modal-title');
        const messageEl = document.getElementById('modal-message');
        const confirmBtn = document.getElementById('modal-confirm-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');

        titleEl.innerText = title;
        messageEl.innerText = message;
        confirmBtn.innerText = confirmText;
        cancelBtn.innerText = cancelText;

        if (isDanger) {
            confirmBtn.className = 'modal-btn danger';
        } else {
            confirmBtn.className = 'modal-btn primary';
        }

        modal.style.display = 'flex';

        function handleConfirm() {
            cleanup();
            resolve(true);
        }

        function handleCancel() {
            cleanup();
            resolve(false);
        }

        function cleanup() {
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            modal.style.display = 'none';
        }

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

async function deleteRound(roundId) {
    const confirmed = await showConfirm({
        title: "Ta bort runda?",
        message: "Är du säker på att du vill ta bort den här rundan permanent? Detta går inte att ångra.",
        confirmText: "Ta bort",
        cancelText: "Avbryt",
        isDanger: true
    });
    if (!confirmed) return;

    await db.strokes.where('round_id').equals(roundId).delete();
    await db.rounds.delete(roundId);

    showRoundsList();
    loadHistory();
}

// Initiera appen
async function initApp() {
    await initSettings();
    bindSettingsEvents();
    if (currentRoundId) {
        startTracking();
    }
    updateUI();
}
initApp();

