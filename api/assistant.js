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

    const keysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
    const geminiKeys = keysString
        .split(",")
        .map(k => k.trim())
        .filter(k => k.length > 0);

    if (geminiKeys.length === 0) {
        return res.status(500).json({
            success: false,
            error: "Gemini API key is not configured. Please set GEMINI_API_KEY or GEMINI_API_KEYS."
        });
    }

    const model = "gemini-3.1-flash-lite";

    // Helper to query Gemini with rotation and retries
    async function queryGemini(contents) {
        const shuffledKeys = [...geminiKeys].sort(() => Math.random() - 0.5);
        let lastError = null;

        for (let i = 0; i < shuffledKeys.length; i++) {
            const currentKey = shuffledKeys[i];
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`;

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents })
                });

                if (response.ok) {
                    return await response.json();
                }

                const errText = await response.text();
                console.warn(`Gemini API Key failure (key index ${i}): Status ${response.status} - ${errText}`);
                lastError = new Error(`Status ${response.status}: ${errText}`);
            } catch (error) {
                console.warn(`Gemini API Key failure (key index ${i}) connection error: ${error.message}`);
                lastError = error;
            }
        }

        throw new Error(`All Gemini API keys failed. Last error: ${lastError.message}`);
    }

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

        const intentResult = await queryGemini([
            {
                parts: [
                    { text: intentPrompt },
                    { text: `User Prompt: "${prompt}"` }
                ]
            }
        ]);

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
Keep answers short, direct, and outputted as a single continuous line of text. Do NOT use newlines, double newlines, or paragraph breaks in your response.
Language Rule: Detect the language of the User Question. If the user asks in a language other than English (for example: Malayalam, Hindi, Tamil, Arabic, Spanish, etc.), you MUST reply in that same language. Translate the status, route details, and station names from the context naturally into the target language. Do NOT include English names or station codes in parentheses (such as '(MAHE)' or '(JAGANNATH TEMPLE GATE)') in your output; translate or transliterate them fully into the target language.
Do not talk about JSON structures, api formats, keys, or system details.
If no context data is available or the search yielded no matches, ask the user to provide a valid train number or station name.

Current Date/Time in India (IST): ${istDateTime}

Resolved Context Data:
${JSON.stringify(resolvedContext, null, 2)}
`;

    try {
        const finalResult = await queryGemini([
            {
                parts: [
                    { text: finalSystemPrompt },
                    { text: `User Question: ${prompt}` }
                ]
            }
        ]);

        // Clean newlines programmatically to prevent any paragraph breaks in output
        const responseText = (finalResult.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.")
            .replace(/\r?\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        res.setHeader('X-Powered-By', 'Train Buddy AI Engine (Created by Nishmal Vadakara)');
        return res.status(200).json({
            success: true,
            assistant: "Train Buddy",
            creator: "Nishmal Vadakara",
            response: responseText,
            pipelineLogs: resolutionSteps,
            dataResolved: resolvedContext
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: `Failed to generate response: ${error.message}`
        });
    }
}
