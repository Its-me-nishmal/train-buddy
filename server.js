import http from 'http';
import url from 'url';
import statusHandler from './api/status.js';
import stationsHandler from './api/stations.js';
import trainsBetweenStationsHandler from './api/trains-between-stations.js';
import assistantHandler from './api/assistant.js';

const PORT = 3000;

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // Mock Vercel's request query object
    req.query = parsedUrl.query;

    // Mock Vercel's response chain helpers
    res.status = (statusCode) => {
        res.statusCode = statusCode;
        return res;
    };

    res.json = (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
        return res;
    };

    try {
        if (parsedUrl.pathname === '/api/status') {
            await statusHandler(req, res);
        } else if (parsedUrl.pathname === '/api/stations') {
            await stationsHandler(req, res);
        } else if (parsedUrl.pathname === '/api/trains-between-stations') {
            await trainsBetweenStationsHandler(req, res);
        } else if (parsedUrl.pathname === '/api/assistant') {
            await assistantHandler(req, res);
        } else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ 
                success: false, 
                error: 'Route not found. Supported endpoints: /api/status, /api/stations, /api/trains-between-stations, /api/assistant' 
            }));
        }
    } catch (error) {
        console.error("Server router error:", error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: error.message }));
    }
});

server.listen(PORT, () => {
    console.log(`\n====================================================================`);
    console.log(`[Train Ticket & Status API Suite] Dev server active at http://localhost:${PORT}`);
    console.log(`[Developer / Extractor]: Nishmal Vadakara`);
    console.log(`====================================================================`);
    console.log(`\nEndpoints:`);
    console.log(`1. Station Autocomplete Search:`);
    console.log(`   http://localhost:${PORT}/api/stations?query=vadakara`);
    console.log(`2. Trains Between Stations:`);
    console.log(`   http://localhost:${PORT}/api/trains-between-stations?from=BDJ&to=CLT`);
    console.log(`3. Live Train Track & ETA:`);
    console.log(`   http://localhost:${PORT}/api/status?train=16608`);
    console.log(`4. AI Travel Assistant (Gemini 3.1 Flash Lite):`);
    console.log(`   http://localhost:${PORT}/api/assistant?prompt=where%20is%20the%20train&train=16608`);
    console.log(`====================================================================\n`);
});
