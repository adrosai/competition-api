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

        // Notice the /v3/ added here!
const response = await fetch(`https://api.competitionsuite.com/v3/events?seasonId=${seasonId}&practice=false`, {
    headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
    }
});

       if (!response.ok) {
    const errorDetails = await response.text(); // Read the exact error from CompetitionSuite
    console.error("API REJECTION DETAILS:", response.status, errorDetails);
    throw new Error(`Failed to fetch events. Status: ${response.status}`);
}

        const eventData = await response.json();
        
        // Send just the "data" array to the frontend
        res.json(eventData.data); 

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error fetching competition data" });
    }
});

// 3. Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});