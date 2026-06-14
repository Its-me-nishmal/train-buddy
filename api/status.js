// In-memory cache stored in the serverless instance memory space
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds cache lifetime

// List of realistic User-Agents to rotate through to bypass bot filters
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Convert "19:52" to "07:52 PM" or strings containing "19:52" to "07:52 PM"
function format24hTo12h(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\b(\d{1,2}):(\d{2})\b/g, (match, h, m) => {
        let hours = parseInt(h, 10);
        if (hours > 23) return match;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${String(hours).padStart(2, '0')}:${m} ${ampm}`;
    });
}

/**
 * Normalizes and cleans the raw payload using unique custom keys
 * Built by developer: Nishmal Vadakara
 */
function cleanTrainData(raw) {
    return {
        extractor: "Nishmal Vadakara",
        timestamp: new Date().toISOString(),
        active: raw.success || false,
        
        trainDetails: {
            id: raw.train_number || "",
            title: raw.train_name || "",
            departureDate: raw.train_start_date || "",
            originStation: raw.source_stn_name || "",
            destinationStation: raw.dest_stn_name || "",
            routeDistanceKm: raw.total_distance || 0,
            avgVelocityKmh: raw.avg_speed || 0,
            gpsTrackingActive: raw.gps_unable === false, // true if GPS is enabled/working
            runsOnDays: raw.run_days ? raw.run_days.split(',') : [],
            pantryAvailable: raw.pantry_available || false,
            journeyTimeMinutes: raw.journey_time || null,
            dataFrom: raw.data_from || "",
            divertedStations: raw.diverted_stations || null,
            criticalAlert: raw.new_alert_msg || ""
        },
        
        trackingPoint: {
            station: raw.current_station_name || "",
            code: raw.current_station_code || "",
            currentStatusText: format24hTo12h(raw.status || ""),
            delayInMinutes: raw.delay || 0,
            lastLoggedAt: format24hTo12h(raw.status_as_of || ""),
            platformAssigned: raw.platform_number || null,
            latitude: raw.cur_stn_lat || 0,
            longitude: raw.cur_stn_lng || 0
        },
        
        journeySummary: raw.bubble_message ? {
            station: raw.bubble_message.station_name,
            update: format24hTo12h(`${raw.bubble_message.message_type} ${raw.bubble_message.station_time}`.trim())
        } : null,
        
        upcomingTarget: raw.next_stoppage_info ? {
            station: raw.next_stoppage_info.next_stoppage,
            etaCountdown: raw.next_stoppage_info.next_stoppage_time_diff,
            expectedDelayMinutes: raw.next_stoppage_info.next_stoppage_delay || 0
        } : null,
        
        liveTimelineLogs: raw.current_location_info ? raw.current_location_info.map(info => ({
            timestampLabel: format24hTo12h(info.label),
            statusMessage: format24hTo12h(info.message),
            indicator: info.hint
        })) : [],

        // We now include passedStops so we don't miss any route history data
        passedStops: raw.previous_stations ? raw.previous_stations.map(st => ({
            seq: st.si_no,
            stationName: st.station_name,
            stationCode: st.station_code,
            scheduledArrival: format24hTo12h(st.sta || null),
            scheduledDeparture: format24hTo12h(st.std || null),
            actualArrival: format24hTo12h(st.eta || null),
            actualDeparture: format24hTo12h(st.etd || null),
            delayMinutes: st.arrival_delay || 0,
            platform: st.platform_number || null,
            distanceFromStartKm: st.distance_from_source || 0
        })) : [],
        
        remainingStops: raw.upcoming_stations ? raw.upcoming_stations.map(st => ({
            seq: st.si_no,
            stationName: st.station_name,
            stationCode: st.station_code,
            scheduledArrival: format24hTo12h(st.sta || null),
            estimatedArrival: format24hTo12h(st.eta || null),
            estimatedDeparture: format24hTo12h(st.etd || null),
            delayMinutes: st.arrival_delay || 0,
            platform: st.platform_number || null,
            distanceFromStartKm: st.distance_from_source || 0,
            distanceFromCurrentKm: st.distance_from_current_station || 0
        })) : []
    };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { train, start_day, raw } = req.query;
    if (!train || !/^\d{5}$/.test(train)) {
        return res.status(400).json({ 
            success: false, 
            error: "Invalid train number format. Must be exactly 5 digits." 
        });
    }

    const day = start_day || "0";
    const cacheKey = `${train}_day_${day}`;

    // Return Cache if HIT
    const cachedItem = cache.get(cacheKey);
    if (cachedItem && (Date.now() - cachedItem.timestamp < CACHE_TTL_MS)) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Powered-By', 'Nishmal Vadakara API Extractor');
        const responseData = (raw === 'true') ? cachedItem.data : cleanTrainData(cachedItem.data);
        return res.status(200).json(responseData);
    }

    const url = `https://livestatus.railyatri.in/api/v3/train_eta_data/${train}/${day}.json?start_day=${day}`;
    const userAgent = getRandomUserAgent();

    try {
        const response = await fetch(url, {
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,ml;q=0.6',
                'origin': 'https://www.railyatri.in',
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
                error: `RailYatri server responded with status code ${response.status}` 
            });
        }

        const data = await response.json();

        // Update Cache
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: data
        });

        res.setHeader('X-Cache', 'MISS');
        res.setHeader('X-Powered-By', 'Nishmal Vadakara API Extractor');
        const responseData = (raw === 'true') ? data : cleanTrainData(data);
        return res.status(200).json(responseData);

    } catch (error) {
        if (cachedItem) {
            res.setHeader('X-Cache', 'FALLBACK');
            res.setHeader('X-Powered-By', 'Nishmal Vadakara API Extractor');
            const responseData = (raw === 'true') ? cachedItem.data : cleanTrainData(cachedItem.data);
            return res.status(200).json(responseData);
        }

        return res.status(500).json({ 
            success: false, 
            error: `API Extraction Failed: ${error.message}` 
        });
    }
}
