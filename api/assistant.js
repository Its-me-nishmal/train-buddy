// Advanced AI Train Assistant Pipeline
// Powered by Google Gemini 3.1 Flash Lite
// Created by Developer: Nishmal Vadakara

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { prompt } = req.query;

    if (!prompt || prompt.trim().length === 0) {
        return res.status(400).json({
            success: false,
            error: "Parameter 'prompt' (user query) is required."
        });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({
            success: false,
            error: "Gemini API key is not configured. Please set the GEMINI_API_KEY environment variable."
        });
    }

    const model = "gemini-3.1-flash-lite";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;

    let resolvedContext = {};
    let resolutionSteps = [];

    try {
        // --- STEP 1: Intent Extraction using Gemini ---
        const intentPrompt = `You are a strict JSON intent extractor.
Analyze the user prompt and extract Indian Railways parameters. Return ONLY a valid JSON object matching the following structure:
{
  "trainNumber": string or null,
  "fromStationQuery": string or null,
  "toStationQuery": string or null,
  "dateQuery": string or null
}
Do not write markdown, code blocks, or explanations. Only return the raw JSON text.

Examples:
Prompt: "where is train 16608 right now?"
Response: {"trainNumber": "16608", "fromStationQuery": null, "toStationQuery": null, "dateQuery": null}

Prompt: "Suggest trains from vadakara to kozhikode on 15 June"
Response: {"trainNumber": null, "fromStationQuery": "vadakara", "toStationQuery": "kozhikode", "dateQuery": "15-6-2026"}
`;

        const intentResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: intentPrompt },
                            { text: `User Prompt: "${prompt}"` }
                        ]
                    }
                ]
            })
        });

        if (intentResponse.ok) {
            const intentResult = await intentResponse.json();
            let intentText = intentResult.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            
            // Clean markdown blocks if returned
            intentText = intentText.replace(/```json/g, '').replace(/```/g, '').trim();
            const intent = JSON.parse(intentText);

            resolutionSteps.push({ phase: "Intent Extraction", result: intent });

            // --- STEP 2: Context Resolution (Station codes / Live Status) ---
            
            // 2a. Resolve Station Queries to Station Codes if present
            let fromCode = null;
            let toCode = null;

            if (intent.fromStationQuery) {
                const resFrom = await fetch(`${baseUrl}/api/stations?query=${encodeURIComponent(intent.fromStationQuery)}`);
                if (resFrom.ok) {
                    const dataFrom = await resFrom.json();
                    if (dataFrom.matches && dataFrom.matches.length > 0) {
                        fromCode = dataFrom.matches[0].code;
                        resolvedContext.fromStation = dataFrom.matches[0];
                        resolutionSteps.push({ phase: "From Station Resolved", code: fromCode, query: intent.fromStationQuery });
                    }
                }
            }

            if (intent.toStationQuery) {
                const resTo = await fetch(`${baseUrl}/api/stations?query=${encodeURIComponent(intent.toStationQuery)}`);
                if (resTo.ok) {
                    const dataTo = await resTo.json();
                    if (dataTo.matches && dataTo.matches.length > 0) {
                        toCode = dataTo.matches[0].code;
                        resolvedContext.toStation = dataTo.matches[0];
                        resolutionSteps.push({ phase: "To Station Resolved", code: toCode, query: intent.toStationQuery });
                    }
                }
            }

            // 2b. If both station codes resolved, query trains between them
            if (fromCode && toCode) {
                // Determine a travel date: default to today (14-06-2026)
                let dateParam = intent.dateQuery || "14-6-2026";
                // Simple parsing of words like "tomorrow" to make it friendly
                if (dateParam.toLowerCase() === "tomorrow") {
                    dateParam = "15-6-2026";
                }
                
                const resTbs = await fetch(`${baseUrl}/api/trains-between-stations?from=${fromCode}&to=${toCode}&date=${dateParam}`);
                if (resTbs.ok) {
                    resolvedContext.trainsBetweenStations = await resTbs.json();
                    resolutionSteps.push({ phase: "Trains Between Stations Fetched", from: fromCode, to: toCode, date: dateParam });
                }
            }

            // 2c. If train number is present, fetch live status
            if (intent.trainNumber) {
                const resStatus = await fetch(`${baseUrl}/api/status?train=${intent.trainNumber}`);
                if (resStatus.ok) {
                    resolvedContext.liveStatus = await resStatus.json();
                    resolutionSteps.push({ phase: "Live Status Fetched", train: intent.trainNumber });
                }
            }
        }
    } catch (e) {
        console.error("Agent Pipeline Resolution error:", e.message);
        resolutionSteps.push({ phase: "Error", message: e.message });
    }

    // --- STEP 3: Final Answer Generation with resolved Context ---
    const istDateTime = new Date().toLocaleString("en-US", {
        timeZone: "Asia/Kolkata",
        dateStyle: "full",
        timeStyle: "long"
    });

    const finalSystemPrompt = `You are a helpful Indian Railways Assistant named 'Train Buddy' (created by Nishmal Vadakara).
You must answer the user's question clearly, concisely, and accurately based ONLY on the provided context data.
Do NOT start your responses with 'Hello! I am Train Buddy (Created by Nishmal Vadakara)' or introduce yourself unless the user specifically asks 'Who are you?' or 'Who created you?'.
Keep answers short and direct.
Do not talk about JSON structures, api formats, keys, or system details.
If no context data is available or the search yielded no matches, ask the user to provide a valid train number or station name.

Current Date/Time in India (IST): ${istDateTime}

Resolved Context Data:
${JSON.stringify(resolvedContext, null, 2)}
`;

    try {
        const finalResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: finalSystemPrompt },
                            { text: `User Question: ${prompt}` }
                        ]
                    }
                ]
            })
        });

        if (!finalResponse.ok) {
            const errText = await finalResponse.text();
            return res.status(finalResponse.status).json({
                success: false,
                error: `Gemini final completion failed: ${errText}`
            });
        }

        const finalResult = await finalResponse.json();
        const responseText = finalResult.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

        res.setHeader('X-Powered-By', 'Train Buddy AI Engine (Created by Nishmal Vadakara)');
        return res.status(200).json({
            success: true,
            assistant: "Train Buddy",
            creator: "Nishmal Vadakara",
            modelUsed: model,
            response: responseText.trim(),
            pipelineLogs: resolutionSteps,
            dataResolved: resolvedContext
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: `Failed to generate final response: ${error.message}`
        });
    }
}
