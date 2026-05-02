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

// 1. The main route: Now fetches the list AND grabs the dates automatically
app.get('/api/season-events', async (req, res) => {
    try {
        const token = await getValidToken();
        const seasonId = '15608'; 

        // Get the lightweight list
        const listResponse = await fetch(`https://api.competitionsuite.com/v3/events?seasonId=${seasonId}&practice=false`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        if (!listResponse.ok) throw new Error("Failed to fetch events list");
        const listData = await listResponse.json();
        const eventsList = listData.data; 

        // Loop through the list and fetch the exact date for each event
        const eventsWithDates = await Promise.all(eventsList.map(async (event) => {
            try {
                const detailResponse = await fetch(`https://api.competitionsuite.com/v3/events/${event.id}`, {
                    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
                });
                
                if (detailResponse.ok) {
                    const detailData = await detailResponse.json();
                    
                    // Dig into the data just like we did on the frontend to find the date
                    if (detailData.competitions && detailData.competitions.length > 0) {
                        // Attach the date directly to the event object
                        event.actualDate = detailData.competitions[0].date; 
                    }
                }
            } catch (err) {
                console.error(`Failed to fetch date for event ${event.id}`);
            }
            
            return event; // Return the event (now with an actualDate attached!)
        }));

        // Send the fully upgraded list to your webpage
        res.json(eventsWithDates); 

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error fetching chained list" });
    }
});

// NOTE: Leave your second route (app.get('/api/event-details/:id')) exactly as it is! 
// The button still needs it to fetch the schedule links.

// 2. THE NEW ROUTE: Gets the details for ONE specific event
// The ":id" in the URL is a variable we can grab
app.get('/api/event-details/:id', async (req, res) => {
    try {
        const token = await getValidToken();
        const eventId = req.params.id; // Grab the exact ID the webpage asked for

        // Make the call to CompetitionSuite for just this one event
        const response = await fetch(`https://api.competitionsuite.com/v3/events/${eventId}`, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error("Failed to fetch event details");
        const detailData = await response.json();
        
        // Send the specific details back to the webpage
        res.json(detailData); 

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error fetching details" });
    }
});

// 3. Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});
