// Root health check endpoint for Train Buddy API
// Created by Developer: Nishmal Vadakara

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    res.setHeader('X-Powered-By', 'Train Buddy Engine (Created by Nishmal Vadakara)');
    
    return res.status(200).json({
        status: "healthy",
        service: "Train Buddy API Suite",
        creator: "Nishmal Vadakara",
        timestamp: new Date().toISOString(),
        endpoints: {
            root: "/",
            liveStatus: "/api/status?train=<5_digit_train_number>",
            stationSearch: "/api/stations?query=<station_name_or_code>",
            trainsBetweenStations: "/api/trains-between-stations?from=<from_code>&to=<to_code>&date=<optional_dd-mm-yyyy>",
            assistant: "/api/assistant?prompt=<natural_language_query>"
        }
    });
}
