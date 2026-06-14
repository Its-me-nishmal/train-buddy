// Serverless handler for searching stations by name/code
// Created by Developer: Nishmal Vadakara

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache for station lists

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { query } = req.query;
    if (!query || query.trim().length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: "Search query parameter 'query' is required." 
        });
    }

    const searchTerm = query.trim().toLowerCase();
    const cacheKey = `station_search_${searchTerm}`;

    // Return Cache if hit
    const cachedItem = cache.get(cacheKey);
    if (cachedItem && (Date.now() - cachedItem.timestamp < CACHE_TTL_MS)) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Powered-By', 'Nishmal Vadakara Station Finder');
        return res.status(200).json(cachedItem.data);
    }

    const url = `https://api.railyatri.in/api/common_city_station_search.json?q=${encodeURIComponent(searchTerm)}&hide_city=true&user_id=-178132392&temp_user_id=-178132392`;

    try {
        const response = await fetch(url, {
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,ml;q=0.6',
                'origin': 'https://www.railyatri.in',
                'priority': 'u=1, i',
                'referer': 'https://www.railyatri.in/',
                'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-site',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                error: `Search service returned HTTP ${response.status}`
            });
        }

        const rawData = await response.json();
        
        // Clean and normalize the response using completely custom key names
        const cleanData = {
            extractor: "Nishmal Vadakara",
            success: rawData.success || false,
            matchCount: rawData.items ? rawData.items.length : 0,
            matches: rawData.items ? rawData.items.map(item => ({
                name: item.station_name || "",
                code: item.station_code || "",
                regionState: item.state_name || "",
                cityAssociated: item.city_name || null
            })) : []
        };

        // Cache the result
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: cleanData
        });

        res.setHeader('X-Cache', 'MISS');
        res.setHeader('X-Powered-By', 'Nishmal Vadakara Station Finder');
        return res.status(200).json(cleanData);

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: `Station Lookup Failed: ${error.message}`
        });
    }
}
