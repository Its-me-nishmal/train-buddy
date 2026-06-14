# High-Performance Train Ticket & Status API Suite

An optimized serverless endpoint ready to deploy on **Vercel** with automatic caching, User-Agent rotation, payload cleaning, custom key naming, error recovery, and an integrated **Gemini 3.1 Flash Lite AI Travel Assistant**.

Developed & Extracted by: **Nishmal Vadakara**

---

## Folder Structure

```text
train-status-api/
├── api/
│   ├── status.js                   # Live status tracker
│   ├── stations.js                 # Station lookup autocomplete
│   ├── trains-between-stations.js  # TBS route & tickets query
│   └── assistant.js                # Gemini 3.1 Flash Lite AI Travel Assistant
├── server.js                       # Local dev server
├── package.json                    # Dependencies and configuration
└── readme.md                       # Deployment and usage instructions
```

---

## Local Development

To run this project locally, make sure you have Node.js installed:

1. Start the dev server:
   ```bash
   npm run dev
   ```

2. Query your local API in browser or Postman:
   `http://localhost:3000/api/status?train=16608`

---

## Deployment to Vercel

Simply run the deploy command in your terminal from the root folder:

```bash
vercel --prod
```

It will give you a live production URL: `https://your-project.vercel.app`.

> [!TIP]
> You can set the environment variable `GEMINI_API_KEY` on Vercel to use your custom API key securely.

---

## API Endpoints

### 1. AI Travel Assistant (`/api/assistant`)
Answers user questions in natural language using real-time context fetched from the status or ticket API.

* **URL**: `/api/assistant?prompt=where%20is%20the%20train%20right%20now&train=16608`
* **Method**: `GET`
* **Response Preview**:
  ```json
  {
      "success": true,
      "assistant": "Nishmal Vadakara AI Assistant",
      "modelUsed": "gemini-3.1-flash-lite",
      "response": "Hello, I am Nishmal Vadakara AI Assistant. The Coimbatore - Kannur Express (16608) is currently at Vadakara (BDJ), having arrived at 19:30. The train is running with a minor delay of 1 minute.",
      "contextAttached": true
  }
  ```

### 2. Station Autocomplete (`/api/stations`)
Returns a simplified and clean JSON payload of station matches for autocomplete search.

* **URL**: `/api/stations?query=vadakara`
* **Method**: `GET`
* **Response Preview**:
  ```json
  {
      "extractor": "Nishmal Vadakara",
      "success": true,
      "matchCount": 1,
      "matches": [
          {
              "name": "VADAKARA",
              "code": "BDJ",
              "regionState": "KERALA",
              "cityAssociated": "Vadakara"
          }
      ]
  }
  ```

### 3. Trains Between Stations (`/api/trains-between-stations`)
Fetches all trains running between two station codes for a given date, with live ticketing classes and seat availability status.

* **URL**: `/api/trains-between-stations?from=BDJ&to=CLT&date=14-6-2026`
* **Method**: `GET`

### 4. Live Train Status (`/api/status`)
Returns a simplified and clean JSON payload of live train progress and schedule.

* **URL**: `/api/status?train=16608`
* **Method**: `GET`
