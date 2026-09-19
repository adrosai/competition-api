require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); 

let cachedToken = null;
let tokenExpirationTime = null;

// ==========================================
// GOOGLE SHEETS PACKET CONFIGURATION
// ==========================================
// Replace this with your published CSV link (File > Share > Publish to web > CSV)
const SHEET_CSV_URL = process.env.GOOGLE_SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTT7wkPZ0xUnxV4XzK36dXxSxWFzgdiqT1Z2rM4U1CGN-L02nXMZcmvmfBcP2Ou6VEDBgiVrFYilXPC/pub?output=csv';

let packetCache = {};
let lastSheetFetch = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getPacketMap() {
    if (Date.now() - lastSheetFetch < CACHE_DURATION && Object.keys(packetCache).length > 0) {
        return packetCache;
    }

    try {
        const response = await fetch(SHEET_CSV_URL);
        if (!response.ok) return packetCache;

        const csvText = await response.text();
        const lines = csvText.trim().split(/\r?\n/);
        const newMap = {};

        // Skip row 0 (headers: eventId, eventName, packetUrl)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Split into CSV cells while preserving commas inside quotes
            const cells = line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)?.map(val => 
                val.replace(/^,/, '').replace(/^"|"$/g, '').trim()
            ) || [];

            // Column A = cells[0] (eventId)
            // Column B = cells[1] (eventName - ignored by backend)
            // Column C = cells[2] (packetUrl)
            const eventId = cells[0];
            const packetUrl = cells[2];

            if (eventId && packetUrl) {
                newMap[eventId] = packetUrl;
            }
        }

        packetCache = newMap;
        lastSheetFetch = Date.now();
        return packetCache;
    } catch (err) {
        console.error("Error fetching Google Sheet CSV:", err);
        return packetCache;
    }
}

// ==========================================
// AUTHENTICATION HELPER
// ==========================================
async function getValidToken() {
    if (cachedToken && Date.now() < tokenExpirationTime) {
        return cachedToken;
    }

    const formData = new URLSearchParams();
    formData.append('grant_type', 'client_credentials');
    formData.append('client_id', process.env.CLIENT_ID);
    formData.append('client_secret', process.env.CLIENT_SECRET);

    const response = await fetch('https://api.competitionsuite.com/v3/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    });

    if (!response.ok) throw new Error("Failed to authenticate");

    const data = await response.json();
    cachedToken = data.access_token;
    tokenExpirationTime = Date.now() + (data.expires_in * 1000) - 300000; 

    return cachedToken;
}

// ==========================================
// ROUTES
// ==========================================

// 1. Season events list with actual dates attached
app.get('/api/season-events', async (req, res) => {
    try {
        const token = await getValidToken();
        const seasonId = '15608'; 

        const listResponse = await fetch(`https://api.competitionsuite.com/v3/events?seasonId=${seasonId}&practice=false`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        if (!listResponse.ok) throw new Error("Failed to fetch events list");
        const listData = await listResponse.json();
        const eventsList = listData.data || []; 

        const eventsWithDates = await Promise.all(eventsList.map(async (event) => {
            try {
                const detailResponse = await fetch(`https://api.competitionsuite.com/v3/events/${event.id}`, {
                    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
                });
                
                if (detailResponse.ok) {
                    const detailData = await detailResponse.json();
                    if (detailData.competitions && detailData.competitions.length > 0) {
                        event.actualDate = detailData.competitions[0].date; 
                    }
                }
            } catch (err) {
                console.error(`Failed to fetch date for event ${event.id}`);
            }
            
            return event;
        }));

        res.json(eventsWithDates); 

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error fetching chained list" });
    }
});

// 2. Event details route (now attaches packetUrl from Google Sheet)
app.get('/api/event-details/:id', async (req, res) => {
    try {
        const token = await getValidToken();
        const eventId = req.params.id;

        const response = await fetch(`https://api.competitionsuite.com/v3/events/${eventId}`, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error("Failed to fetch event details");
        const detailData = await response.json();
        
        // Attach the manual info packet URL from Google Sheet
        const packetMap = await getPacketMap();
        detailData.packetUrl = packetMap[eventId] || null;

        res.json(detailData); 

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error fetching details" });
    }
});

// 3. Bands roster route
app.get('/api/bands', async (req, res) => {
    try {
        const token = await getValidToken();
        const seasonId = '15608'; 
        
        const response = await fetch(`https://api.competitionsuite.com/v3/groups?seasonId=${seasonId}`, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error("Failed to fetch bands list");
        
        const bandData = await response.json();
        res.json(bandData.data || bandData); 

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error fetching bands" });
    }
});

// 4. Helper export route: Visits this URL to download a pre-filled CSV for Google Sheets
app.get('/api/export-events-csv', async (req, res) => {
    try {
        const token = await getValidToken();
        const seasonId = '15608';

        const listResponse = await fetch(`https://api.competitionsuite.com/v3/events?seasonId=${seasonId}&practice=false`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        if (!listResponse.ok) throw new Error("Failed to fetch events");
        const listData = await listResponse.json();
        const eventsList = listData.data || [];

        let csv = 'eventId,eventName,packetUrl\n';
        eventsList.forEach(e => {
            const safeName = `"${(e.name || '').replace(/"/g, '""')}"`;
            csv += `${e.id},${safeName},\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="events-template.csv"');
        res.send(csv);

    } catch (err) {
        console.error(err);
        res.status(500).send("Error generating export");
    }
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});
