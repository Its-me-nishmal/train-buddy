// Serverless handler for finding trains running between stations
// Created by Developer: Nishmal Vadakara

const cache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes cache for ticket/route queries

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { from, to, date, raw } = req.query;
    if (!from || !to) {
        return res.status(400).json({ 
            success: false, 
            error: "Parameters 'from' and 'to' (station codes) are required." 
        });
    }

    // Default to current date in DD-MM-YYYY format if not provided
    let journeyDate = date;
    if (!journeyDate) {
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        journeyDate = `${dd}-${mm}-${yyyy}`;
    }

    const cacheKey = `tbs_${from}_${to}_${journeyDate}`;

    // Return Cache if hit
    const cachedItem = cache.get(cacheKey);
    if (cachedItem && (Date.now() - cachedItem.timestamp < CACHE_TTL_MS)) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Powered-By', 'Nishmal Vadakara Route Planner');
        const responseData = (raw === 'true') ? cachedItem.data : cleanTbsData(cachedItem.data);
        return res.status(200).json(responseData);
    }

    // Call the RailYatri endpoint
    const url = `https://trainticketapi.railyatri.in/api/trains-between-station-with-sa.json?from=${from}&to=${to}&dateOfJourney=${journeyDate}&action=train_between_station&controller=train_ticket_tbs&device_type_id=6&from_code=${from}&to_code=${to}&journey_date=${journeyDate}&journey_quota=GN&to_code=${to}&authentication_token=&v_code=null&user_id=-178137273&temp_user_id=-178137273`;

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
                error: `Route search service returned HTTP ${response.status}`
            });
        }

        const data = await response.json();

        // Cache the result
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: data
        });

        res.setHeader('X-Cache', 'MISS');
        res.setHeader('X-Powered-By', 'Nishmal Vadakara Route Planner');
        const responseData = (raw === 'true') ? data : cleanTbsData(data);
        return res.status(200).json(responseData);

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: `Route Lookup Failed: ${error.message}`
        });
    }
}

function cleanTbsData(raw) {
    // Combine reserved_trains and alternate_trains from RailYatri response
    const trainsList = [
        ...(raw.reserved_trains || []),
        ...(raw.alternate_trains || [])
    ];
    
    return {
        extractor: "Nishmal Vadakara",
        timestamp: new Date().toISOString(),
        origin: raw.from_station_name || "",
        destination: raw.to_station_name || "",
        totalMatchedCount: trainsList.length,
        trainsList: trainsList.map(train => {
            // Collect all available seat classes and details
            const seats = train.sa_data ? train.sa_data.map(sa => ({
                seatClass: sa.booking_class || "",
                status: sa.availibility || "",
                fareAmount: sa.seat_availibility && sa.seat_availibility[0] ? sa.seat_availibility[0].total_fare : null,
                lastUpdated: sa.seat_availibility && sa.seat_availibility[0] ? sa.seat_availibility[0].cache_text : ""
            })) : [];

            return {
                trainNumber: train.train_number || "",
                trainName: train.train_name || "",
                duration: train.duration || "",
                departureTime: train.from_std || train.dep_time || "",
                arrivalTime: train.to_sta || train.arr_time || "",
                runsOnDays: train.run_days || [],
                classesAvailable: train.class_type ? train.class_type.map(c => c.coach_type) : [],
                seatAvailability: seats
            };
        })
    };
}
