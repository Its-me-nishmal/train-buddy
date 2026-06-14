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

    // Calculate current dynamic IST date for relative date resolution in Step 1
    const todayIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const todayStr = `${todayIST.getDate()}-${todayIST.getMonth() + 1}-${todayIST.getFullYear()}`;
    
    const tomorrowIST = new Date(todayIST);
    tomorrowIST.setDate(todayIST.getDate() + 1);
    const tomorrowStr = `${tomorrowIST.getDate()}-${tomorrowIST.getMonth() + 1}-${tomorrowIST.getFullYear()}`;

    let resolvedContext = {};
    let resolutionSteps = [];

    try {
        // --- STEP 1: Intent Extraction using Gemini ---
        const intentPrompt = `You are a strict JSON intent extractor.
Analyze the user prompt and extract Indian Railways parameters. Return ONLY a valid JSON object matching the following structure:
{
  "trainNumber": string or null,
  "trainQuery": string or null,
  "fromStationQuery": string or null,
  "toStationQuery": string or null,
  "dateQuery": string or null
}
Do not write markdown, code blocks, or explanations. Only return the raw JSON text.

Reference Current Date/Time in India (IST): ${new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })}
Reference Date Mapping: Today is ${todayStr}, Tomorrow is ${tomorrowStr}.
If the user specifies a relative date (like "today", "tomorrow", "day after tomorrow", "next Monday", or a day of the week), resolve it to the exact date in "D-M-YYYY" format based on the current IST date.

Examples:
Prompt: "where is train 16608 right now?"
Response: {"trainNumber": "16608", "trainQuery": null, "fromStationQuery": null, "toStationQuery": null, "dateQuery": null}

Prompt: "where is Okha - Ernakulam Express?"
Response: {"trainNumber": null, "trainQuery": "Okha - Ernakulam Express", "fromStationQuery": null, "toStationQuery": null, "dateQuery": null}

Prompt: "Suggest trains from vadakara to kozhikode on 18 June"
Response: {"trainNumber": null, "trainQuery": null, "fromStationQuery": "vadakara", "toStationQuery": "kozhikode", "dateQuery": "18-6-2026"}

Prompt: "trains between clt and can tomorrow"
Response: {"trainNumber": null, "trainQuery": null, "fromStationQuery": "clt", "toStationQuery": "can", "dateQuery": "${tomorrowStr}"}
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

        // 2b. Resolve Train Query if trainNumber is not a 5-digit number
        let resolvedTrainNumber = intent.trainNumber;
        if (!resolvedTrainNumber && intent.trainQuery) {
            try {
                async function querySearch(q) {
                    const url = `https://search.railyatri.in/v2/mobile/trainsearch.json?q=${encodeURIComponent(q)}&user_id=-178137273&temp_user_id=-178137273`;
                    const res = await fetch(url);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.success && data.trains && data.trains.length > 0) {
                            return data.trains;
                        }
                    }
                    return null;
                }

                let searchResults = await querySearch(intent.trainQuery);
                let cleanedQuery = intent.trainQuery
                    .replace(/\b(express|superfast|sf|passenger|mail|special|train|unreserved|exp|pass)\b/gi, '')
                    .replace(/[^a-zA-Z0-9\s-]/g, '')
                    .trim();

                if (!searchResults && cleanedQuery && cleanedQuery !== intent.trainQuery) {
                    searchResults = await querySearch(cleanedQuery);
                }

                let parts = cleanedQuery.split(/[-]|to/gi).map(p => p.trim()).filter(p => p.length > 0);
                if (!searchResults && parts.length > 0) {
                    searchResults = await querySearch(parts[0]);
                }

                if (searchResults && searchResults.length > 0) {
                    let bestMatch = searchResults[0];
                    if (searchResults.length > 1 && parts.length > 0) {
                        const matched = searchResults.find(t => {
                            const lowerName = t.train_name.toLowerCase();
                            return parts.every(part => lowerName.includes(part.toLowerCase()));
                        });
                        if (matched) {
                            bestMatch = matched;
                        }
                    }
                    resolvedTrainNumber = bestMatch.train_number;
                    resolvedContext.searchedTrainDetails = bestMatch;
                    resolutionSteps.push({ phase: "Train Search Resolved", query: intent.trainQuery, resolvedNumber: resolvedTrainNumber });
                }
            } catch (e) {
                console.error("Train Search API error:", e.message);
            }
        }

        // 2c. If both station codes resolved, query trains between them
        if (fromCode && toCode) {
            // Determine travel date: default to today dynamically
            let dateParam = intent.dateQuery || todayStr;
            
            const resTbs = await fetch(`${baseUrl}/api/trains-between-stations?from=${fromCode}&to=${toCode}&date=${dateParam}`);
            if (resTbs.ok) {
                resolvedContext.trainsBetweenStations = await resTbs.json();
                resolutionSteps.push({ phase: "Trains Between Stations Fetched", from: fromCode, to: toCode, date: dateParam });
            }
        }

        // 2d. If train number is resolved, fetch live status
        if (resolvedTrainNumber) {
            const resStatus = await fetch(`${baseUrl}/api/status?train=${resolvedTrainNumber}`);
            if (resStatus.ok) {
                resolvedContext.liveStatus = await resStatus.json();
                resolutionSteps.push({ phase: "Live Status Fetched", train: resolvedTrainNumber });
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
Language Rule: By default, you MUST reply in English. If the user writes in English, Manglish (Malayalam in English script), or any ambiguous/mix/unspecified language, you MUST reply in English. Only reply in a non-English language (such as native Malayalam, Hindi, Tamil, etc.) if they explicitly write in that native non-English script (e.g., മലയാളം script, हिंदी script, etc.). Translate the status, route details, and station names from the context naturally. Do NOT include English names or station codes in parentheses (such as '(MAHE)') in non-English output; translate or transliterate them fully.
WhatsApp Formatting Rules:
- You MUST format your response for WhatsApp using its supported styling elements.
- Use newlines (single line breaks) to structure your response into lists or sections.
- When listing multiple trains, routes, or items, you MUST structure them as a bulleted list where each item is on its own separate line starting with "- " (a hyphen followed by a space). Do NOT combine them into a single line with commas.
- For bulleted lists, start each line with "- " (a hyphen followed by a space). Do NOT use asterisks for bullet markers to avoid clash with bold formatting.
- For numbered lists, start each line with "1. " (a number, period, and space).
- For block quotes, start each line with "> " (greater-than sign and space).
- Use single asterisks (\`*\`) on both sides for bold text (e.g. \`*16608*\`). Do NOT use double asterisks (\`**\`).
- Use single underscores (\`_\`) on both sides for italic text (e.g. \`_Vadakara_\`).
- Use single backticks (\`\` \` \`\`) on both sides for inline code or highlight.
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

        // Clean trailing/leading spaces, compress consecutive spaces but preserve newlines
        let responseText = (finalResult.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.")
            .replace(/[^\S\r\n]+/g, ' ')
            .trim();

        // 1. Convert bullet list asterisks (* ), dashes, or unicode bullets (\u2022) to native WhatsApp hyphen bullet format (- ) to avoid double-asterisk issues (* *train*)
        responseText = responseText.replace(/^[ \t]*[*•\u2022\u2023\u25e6\u25cf\u2219\u203a\u25aa\u25ab\u2010-\u2015-][ \t]+/gm, '- ');

        // 2. Convert markdown bold (**text** or __text__) to WhatsApp bold (*text*)
        responseText = responseText.replace(/\*\*([^*]+)\*\*/g, '*$1*');
        responseText = responseText.replace(/__([^_]+)__/g, '*$1*');

        // 3. Convert markdown strikethrough (~~text~~) to WhatsApp strikethrough (~text~)
        responseText = responseText.replace(/~~([^~]+)~~/g, '~$1~');

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
