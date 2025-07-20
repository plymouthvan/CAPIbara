# Template System – CAPIbara

CAPIbara uses a JSON-based templating system to transform incoming GA4-style event data into platform-specific formats (e.g. Meta CAPI, GA4 Measurement Protocol). Templates are external files defined in environment variables and can be modified without changing application logic.

## 🔧 Template Format

Templates are standard JSON files. Fields can contain:

- **Literal values** – Strings, numbers, booleans
- **Token-based substitution** – `"{{path.to.value}}"`
- **Optional expressions** – `"{{some.value || 'fallback'}}"`

> **Note:** Only simple path-based substitution and a single-level fallback using `||` are supported. No nested expressions, functions, or arbitrary JavaScript are allowed inside tokens. Only one `||` fallback per token. Anything beyond this is invalid and will cause a startup error.

The app recursively resolves all template fields using the incoming event payload.

## 📦 Passthrough Mode

In addition to templated transformation, CAPIbara supports a passthrough mode for raw forwarding of JSON payloads. This is useful for integrations with systems like n8n, Zapier, or Make where transformation is handled elsewhere or unnecessary.

While the system is optimized for GA4-style events, any well-formed JSON payload will be accepted and forwarded as-is.


To enable passthrough, omit the `template` field in a route definition inside `routes.json`. CAPIbara will detect the absence of a template and forward the request body unaltered to the `target_url`.

> **Note:** Passthrough mode is enabled only when the `template` field is completely absent from the route definition. Setting `template` to `null`, an empty string, or any other value will not enable passthrough mode.

```json
{
  "routes": [
    {
      "name": "send-to-n8n-as-is",
      "event_match": "*",
      "target_url": "https://automate.example.com/webhook/ga4-ingest",
      "method": "POST"
    }
  ]
}
```

## 🧩 Input Data Available

- The raw JSON event payload sent by the browser (typically GA4-style)
- Request metadata:
  - `meta.ip`: IP address (from request or `X-Forwarded-For`)
  - `meta.user_agent`: User-Agent string
  - `meta.timestamp`: UNIX timestamp at receipt time

## 🧰 Missing Value Handling

- By default, **missing fields are excluded** from the final payload
  - `"email": "{{user_properties.email}}"` → omitted if `email` is undefined
- To override, use fallback logic:
  - `"email": "{{user_properties.email || null}}"`
  - `"currency": "{{params.currency || 'USD'}}"`

> **Note:** Only single-level fallback using `||` is supported inside tokens. Chained logic, ternary operations, or any additional JavaScript-like syntax is not allowed.

## 📄 Example Files

- [`meta.json`](./meta.json) – Template for Meta Conversions API payload
- [`ga4.json`](./ga4.json) – Template for GA4 Measurement Protocol forwarding

## 🔐 Route Authentication

To prevent abuse and unauthorized use, each route in `routes.json` must define its authentication strategy. Authentication is required.

Supported strategies:

- `"auth": { "type": "whitelist", "origins": ["https://example.com"] }` – Origin-based
- `"auth": { "type": "apikey", "key": "expected-api-key" }` – Header-based
- `"auth": { "type": "ip_whitelist", "allowed_ips": [...] }` – IP-based


Only one authentication strategy may be specified per route. If more than one is provided, the server exits with an error.

> **Note:** If more than one authentication strategy is provided on a route, the server will fail to start and exit with an error message indicating the conflicting strategies. A route is considered invalid if its `auth` block contains multiple strategy types, missing required fields for the chosen strategy, or unknown strategy types. All such errors are fatal at startup and must be logged clearly.

If `auth` is missing or invalid on a route, the request will be rejected with a 403 response.

Authentication is designed to be flexible and composable. You can define global environment variables for API keys or secrets (e.g., `MY_PRIVATE_KEY=abc123` in `.env`) and reference them in routes using `{{MY_PRIVATE_KEY}}`.

Example route with authentication:
```json
{
  "name": "forward-to-n8n",
  "event_match": "*",
  "target_url": "https://automate.example.com/webhook/ga4-ingest",
  "method": "POST",
  "auth": {
    "type": "apikey",
    "key": "{{MY_PRIVATE_KEY}}"
  }
}
```

- When using `"auth": { "type": "whitelist", "origins": [...] }`, the server must enforce access based on the HTTP `Origin` header.
- If the `Origin` header is missing or does not match, respond with 403 Forbidden and log the attempt.
- For IP-based access control, use `"auth": { "type": "ip_whitelist", "allowed_ips": [...] }`.

## 🔀 Routing Behavior

Route and template files are read once at server startup. Any modification requires a server restart to take effect.

CAPIbara uses `routes.json` to determine how to handle incoming events. Here’s how routing works in practice:

### 🧭 Route Matching

Routes are matched based on the `event_match` key in each route definition. Matching behavior:

- `"*"` matches all events.
- Wildcards like `"purchase.*"` are supported.
- Matches apply to `events.0.name` by default.

**Multiple matching routes** are allowed but discouraged unless explicitly desired. Only one route is processed unless `"multi": true` is set:

This is useful when you want a single incoming event to trigger multiple routes — for example, forwarding the same event to both GA4 and Meta. As long as you include a consistent `event_id` across both payloads, Meta will deduplicate properly between Pixel and CAPI, and GA4 will operate independently.

```json
{
  "event_match": "purchase",
  "multi": true
}
```


Routes are evaluated in the order listed in `routes.json`. For deterministic behavior, use `"priority"`:

> **Note:** If multiple routes have the same priority value, the first route listed in `routes.json` takes precedence. Only one route is processed unless `"multi": true` is set. If `"multi": true` is set on multiple matching routes, all are executed in the order they appear in `routes.json`.

```json
{
  "event_match": "purchase",
  "priority": 10
}
```

Lower values = higher priority.

If `multi` is false or absent, only the first matching route (by order or ascending `priority`) is executed.

### 📄 Incoming Payload Assumptions

- Each incoming event payload is assumed to be GA4-style with `events[0].name` available.
- If the payload is not valid JSON or lacks `events[0].name`, the server must respond with 400 Bad Request and log the error.
- If the payload is valid JSON but does not match any route, it is logged as "unmatched" in `/debug` and not forwarded.

### 📥 If No Routes Match

If an incoming event does not match any route:

- The request is logged in `/debug` (if enabled).
- A 200 OK response is returned by default.
- Optionally, a fallback route can be defined:

```json
{
  "event_match": "*",
  "fallback": true
}
```

Only one fallback route is allowed. It catches unmatched events.

- A fallback route only handles unmatched events if it is explicitly defined as `{ "fallback": true }`.
- No other route should process unmatched events.
- Only one fallback route is allowed; if more than one is defined, the application must log an error at startup and refuse to run.

> **Note:** If multiple fallback routes (i.e., routes with `"fallback": true`) are defined, the application must immediately log a clear error and exit during startup. No routes will be processed until the conflict is resolved.

To detect silent failures, enable:

```env
LOG_UNMATCHED_EVENTS=true
```

### 📁 Template Discovery

Templates are resolved relative to a central `/templates` directory. Template paths in `routes.json` must be relative:

```json
"template": "meta.json"
```

Subdirectories are supported:

```json
"template": "meta/standard.json"
```

---

### 🛑 Template and Route File Validity

- If a required template or route file is missing, malformed, or unreadable at startup, the application must log a clear error and exit.

  > **Note:** "Malformed" means invalid JSON syntax or missing required keys in the template or route files. "Unreadable" means the file path does not exist or the file cannot be accessed due to permissions. All such errors are fatal at startup and must be logged explicitly.

- If a template or route file fails to parse as valid JSON at startup, the server logs an error and exits. If a referenced template cannot be loaded at runtime (due to file deletion or corruption), the route is skipped and the error logged in `/debug`.

  > **Note:** Runtime errors loading templates should not crash the server but must be logged in `/debug` with enough detail to diagnose the issue.

## 🧪 Debugging

- Use `DEBUG_LOGGING=true` in `.env` to print resolved template output
- `/debug` endpoint (v1): Returns the most recent resolved events and their transformed payloads. Each entry includes:
  - What was received and from where (source IP and endpoint)
  - What was sent and to where (target URL and transformed body)
  - Resolution status and timestamps

### 🔁 Debug Log Persistence

Debug logs are held in memory by default. You can control their behavior via environment variables:

- `DEBUG_MAX_ENTRIES=100` — Maximum number of recent debug entries to retain in memory (default: 100)
- `DEBUG_LOGGING=false` — Disables debug logging entirely (useful for production performance)

These options help balance observability and performance depending on the deployment context.


If `DEBUG_MAX_ENTRIES` < 1, debug log retention is disabled. If greater than 1000, only the 1000 most recent entries are retained.

> **Note:**  
> - If `DEBUG_MAX_ENTRIES` is set to 0 or any negative value, no debug entries are retained in memory.  
> - If `DEBUG_MAX_ENTRIES` is greater than 1000, only the 1000 most recent entries are kept.  
> - Any non-integer or invalid value will cause the application to log a startup error and exit.

### Example Response:
```json
[
  {
    "timestamp": 1723484321,
    "source_ip": "203.0.113.1",
    "source_path": "/g/collect",
    "route": "send-to-meta",
    "original_payload": { ... },
    "transformed_payload": { ... },
    "target_url": "https://graph.facebook.com/v18.0/<pixel-id>/events",
    "status": "success"
  },
  {
    "timestamp": 1723484335,
    "source_ip": "203.0.113.2",
    "source_path": "/g/collect",
    "route": "send-to-n8n-as-is",
    "original_payload": { ... },
    "transformed_payload": null,
    "target_url": "https://automate.example.com/webhook/ga4-ingest",
    "status": "passthrough"
  }
]
```

### Example: Meta Template (`meta.json`)
```json
{
  "event_name": "{{events.0.name}}",
  "event_time": "{{meta.timestamp}}",
  "action_source": "website",
  "event_source_url": "{{page_location}}",
  "user_data": {
    "client_user_agent": "{{meta.user_agent}}",
    "client_ip_address": "{{meta.ip}}",
    "em": "{{user_properties.email}}"
  },
  "custom_data": {
    "value": "{{events.0.params.value}}",
    "currency": "{{events.0.params.currency || 'USD'}}"
  }
}
```

### Example: GA4 Template (`ga4.json`)
```json
{
  "client_id": "{{client_id}}",
  "events": [
    {
      "name": "{{events.0.name}}",
      "params": {
        "value": "{{events.0.params.value}}",
        "currency": "{{events.0.params.currency || 'USD'}}"
      }
    }
  ]
}
```

## 🧪 Template Testing & Dry Run

CAPIbara includes a `/dry-run` endpoint for safely testing incoming payloads against route templates without forwarding them to external targets. This is useful for validating template output, debugging field resolution, or preflight checks before going live.

### 🔄 Usage

Send a `POST` request to `/dry-run` with the exact payload you intend to send during production. CAPIbara will simulate the routing logic and return:

- Which route(s) the payload would match
- What transformed payload(s) would be produced
- What `target_url` each would be sent to
- Authentication checks will still apply as usual

### 📝 Example Request
```bash
curl -X POST http://localhost:8080/dry-run \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d @test-event.json
```

### 🧾 Example Response
```json
{
  "matched_routes": [
    {
      "route": "send-to-meta",
      "target_url": "https://graph.facebook.com/v18.0/123456789/events",
      "transformed_payload": {
        "event_name": "purchase",
        "event_time": 1723484321,
        ...
      }
    }
  ]
}
```

No data is sent to any third-party during a dry-run request. This is a safe, repeatable utility for development, QA, or debugging.

## 🚀 Deployment & CLI Usage

You can run CAPIbara either via Node directly or using Docker (recommended).

### 🐳 Docker

Build and run using Docker:

A `Dockerfile` is included in the repository to support containerized deployments.

```bash
docker build -t capibara .
docker run -p 8080:8080 --env-file .env -v $(pwd)/routes.json:/app/routes.json -v $(pwd)/templates:/app/templates capibara
```

Ensure you mount your local `routes.json` and `/templates` directory into the container.

### 🧪 Local Development

Install dependencies and run:

```bash
npm install
node index.js
```

### 📂 Configuration Files

- `.env`: Defines environment variables such as `DEBUG_LOGGING=true`, `PORT=8080`, etc.
- `routes.json`: Placed in the root directory or mounted into `/app/routes.json` in Docker. Defines how events are routed.
- `/templates`: Directory containing JSON templates referenced in `routes.json`.

All paths inside `routes.json` are relative to `/templates/`.

Outgoing requests always use HTTP POST. If the `headers` field is not set in a route, `Content-Type: application/json` is used for outgoing requests by default.
