require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); 

let cachedToken = null;
let tokenExpirationTime = null;

// 1. Function to securely get the authorization token
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

// 2. Your custom endpoint that your webpage will talk to
app.get('/api/season-events', async (req, res) => {
    try {
        const token = await getValidToken();
        const seasonId = '15608'; 

        // STEP 1: Fetch the master list of events
        const listResponse = await fetch(`https://api.competitionsuite.com/v3/events?seasonId=${seasonId}&practice=false`, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!listResponse.ok) throw new Error("Failed to fetch events list");
        
        const listData = await listResponse.json();
        const eventsList = listData.data; 

        // STEP 2: Loop through the list and fetch details for each event ID
        // Promise.all runs all these secondary fetches at the exact same time for speed
        const eventsWithDetails = await Promise.all(eventsList.map(async (event) => {
            
            // Extract the ID from the current event
            const eventId = event.id;

            // Make the call to your second API 
            // (Replace this URL if you are using a completely different website's API)
            const detailResponse = await fetch(`https://api.competitionsuite.com/v3/events/${eventId}`, {
                headers: {
                    'Accept': 'application/json',

                }
            });

            // If the second API works, extract the JSON. If it fails, return null.
            let detailData = null;
            if (detailResponse.ok) {
                detailData = await detailResponse.json();
            }

            // STEP 3: Stitch them together! 
            // The "..." spreads out the original event, and we attach the new data to the end.
            return {
                ...event, 
                extendedDetails: detailData 
            };
        }));

        // STEP 4: Send the fully assembled, super-charged array back to your webpage
        res.json(eventsWithDetails); 

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error fetching chained competition data" });
    }
});

// 3. Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});
