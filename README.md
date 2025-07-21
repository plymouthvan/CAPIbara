# CAPIbara

CAPIbara is a JSON-based templating system designed to transform incoming GA4-style event data into platform-specific formats for services like Meta Conversions API, GA4 Measurement Protocol, and other webhook endpoints. It acts as a powerful middleware layer that receives analytics events from your website and intelligently routes them to multiple destinations with custom transformations.

## 🎯 Purpose & Use Cases

CAPIbara solves the common challenge of sending the same analytics event to multiple platforms that each require different data formats. Instead of implementing complex client-side logic or managing multiple tracking implementations, CAPIbara provides a single endpoint that can:

- **Transform GA4 events** into Meta Conversions API format for server-side tracking
- **Forward events** to automation platforms like n8n, Zapier, or Make
- **Route events** to multiple destinations simultaneously with different transformations
- **Authenticate requests** using various strategies (API keys, origin whitelists, IP restrictions)
- **Debug and monitor** event processing with built-in logging and dry-run capabilities

Common use cases include e-commerce conversion tracking, lead generation, customer journey analytics, and marketing automation workflows.

## 📁 Project Structure

```
CAPIbara/
├── index.js                 # Application entry point with startup validation
├── package.json            # Node.js dependencies and scripts
├── routes.json             # Route configuration (defines how events are processed)
├── .env                    # Environment variables (not in repo)
├── .env.example            # Environment variable template
├── Dockerfile              # Container deployment configuration
├── src/                    # Core application modules
│   ├── server.js           # Express server setup and middleware
│   ├── config.js           # Configuration loading and validation
│   ├── router.js           # Route matching and processing logic
│   ├── template-engine.js  # JSON template processing with token substitution
│   ├── auth.js             # Authentication strategies (API key, whitelist, IP)
│   ├── debug.js            # Debug logging and monitoring
│   └── utils.js            # Utility functions
└── templates/              # JSON transformation templates
    ├── meta.json           # Meta Conversions API template
    └── ga4.json            # GA4 Measurement Protocol template
```

## 🚀 Quick Start

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/plymouthvan/CAPIbara.git
   cd CAPIbara
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Set up routes:**
   ```bash
   cp routes.json.example routes.json
   # Edit routes.json with your destinations
   ```

4. **Run the application:**
   ```bash
   node index.js
   ```

Your CAPIbara server will be running on `http://localhost:8080` with endpoints:
- `POST /g/collect` - Main event collection endpoint
- `POST /dry-run` - Test transformations without sending data
- `GET /debug` - View recent events and processing logs
- `GET /health` - Health check endpoint

## 🔧 Template Format

Templates are standard JSON files. Fields can contain:

- **Literal values** – Strings, numbers, booleans
- **Token-based substitution** – `"{{path.to.value}}"`
- **Optional expressions** – `"{{some.value || 'fallback'}}"`

> **Note:** Only simple path-based substitution and a single-level fallback using `||` are supported. No nested expressions, functions, or arbitrary JavaScript are allowed inside tokens. Only one `||` fallback per token. Anything beyond this is invalid and will cause a startup error.

The app recursively resolves all template fields using the incoming event payload.

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

## 🔀 Routing Behavior

Route and template files are read once at server startup. Any modification requires a server restart to take effect.

CAPIbara uses `routes.json` to determine how to handle incoming events. Here's how routing works in practice:

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

### 🛑 Template and Route File Validity

- If a required template or route file is missing, malformed, or unreadable at startup, the application must log a clear error and exit.

  > **Note:** "Malformed" means invalid JSON syntax or missing required keys in the template or route files. "Unreadable" means the file path does not exist or the file cannot be accessed due to permissions. All such errors are fatal at startup and must be logged explicitly.

- If a template or route file fails to parse as valid JSON at startup, the server logs an error and exits. If a referenced template cannot be loaded at runtime (due to file deletion or corruption), the route is skipped and the error logged in `/debug`.

  > **Note:** Runtime errors loading templates should not crash the server but must be logged in `/debug` with enough detail to diagnose the issue.

## 📊 Server Logs & Observability

CAPIbara provides comprehensive logging capabilities for production monitoring and debugging.

### 🗂️ File Logging

CAPIbara supports persistent file logging with structured JSON format for production observability:

- **Log Location**: `/var/log/capibara/capibara.log` (production) or `./logs/capibara.log` (local)
- **Format**: Structured JSON with request correlation
- **Rotation**: Automatic rotation at 1MB with 3 file retention
- **Request Correlation**: Each request gets a UUID v4 for tracing across systems

#### Configuration

Enable file logging via environment variables:

```env
FILE_LOGGING_ENABLED=true
FILE_LOG_MAX_SIZE=1048576    # 1MB in bytes
FILE_LOG_MAX_FILES=3         # Number of rotated files to keep
LOG_DIRECTORY=/var/log/capibara  # Custom log directory (optional)
```

#### Log Entry Structure

Each log entry contains comprehensive request information:

```json
{
  "level": "info",
  "message": {
    "timestamp": "2025-07-21T02:37:10.334Z",
    "request_id": "5f4f3ee5-58c9-44a3-be8f-fb664e5a9966",
    "source_ip": "::1",
    "source_path": "/g/collect",
    "route_name": "test-route",
    "auth_status": "success",
    "processing_status": "success",
    "target_url": "https://httpbin.org/post",
    "http_status": 200,
    "duration_ms": 270,
    "error_message": null,
    "error_code": null,
    "user_agent": "curl/8.7.1",
    "request_body": {...},
    "transformed_payload": {...}
  },
  "timestamp": "2025-07-21T02:37:10.334Z"
}
```

#### Log Field Descriptions

- **`request_id`**: UUID v4 for request correlation across logs and systems
- **`auth_status`**: Authentication result (`success`, `auth_failed`, `validation_failed`, `no_match`)
- **`processing_status`**: Route processing result (`success`, `passthrough`, `auth_failed`, `validation_error`, `forwarding_error`, `unmatched`)
- **`duration_ms`**: Request processing duration in milliseconds
- **`error_code`**: Specific error code (e.g., `ECONNABORTED`, `HTTP_404`, `NO_RESPONSE`)
- **`request_body`**: Original request payload (only logged when `DEBUG_LOGGING=true`)

#### Status Code Meanings

- **`success`**: Template processed and forwarded successfully
- **`passthrough`**: Raw payload forwarded successfully (no template)
- **`auth_failed`**: API key/origin/IP authentication failed
- **`validation_error`**: Payload validation failed (missing events[0].name)
- **`forwarding_error`**: HTTP request to target failed
- **`unmatched`**: No route matched the event name

### 🔍 Console Logging

In addition to file logging, CAPIbara provides real-time console logging:

```
2025-07-21T02:37:10.064Z [5f4f3ee5-58c9-44a3-be8f-fb664e5a9966] POST /g/collect from ::1
[2025-07-21T02:37:10.000Z] SUCCESS test-route (270ms) -> https://httpbin.org/post
```

Each console log entry includes:
- Timestamp and request ID for correlation
- Request method, path, and source IP
- Processing result with route name, duration, and target URL

### 🧪 Test Mode Logging

Enable enhanced logging for development and testing:

```env
CAPI_TEST_MODE=true
DEBUG_LOGGING=true
```

Test mode provides additional logging detail and preserves request bodies for debugging.

### 📈 Log Monitoring

For production monitoring, you can:

1. **Tail logs in real-time**:
   ```bash
   tail -f /var/log/capibara/capibara.log | jq .
   ```

2. **Search for specific request IDs**:
   ```bash
   grep "5f4f3ee5-58c9-44a3-be8f-fb664e5a9966" /var/log/capibara/capibara.log
   ```

3. **Filter by status**:
   ```bash
   jq 'select(.message.processing_status == "auth_failed")' /var/log/capibara/capibara.log
   ```

4. **Monitor error rates**:
   ```bash
   jq 'select(.message.http_status >= 400)' /var/log/capibara/capibara.log
   ```

## 🚀 Deployment & CLI Usage

You can run CAPIbara either via Node directly or using Docker (recommended).

### 🐳 Docker

#### Using Pre-built Image from GitHub Container Registry

The easiest way to run CAPIbara is using the pre-built Docker image:

```bash
# Pull the latest image
docker pull ghcr.io/plymouthvan/capibara:latest

# Run with your configuration files
docker run -p 8080:8080 \
  --env-file .env \
  -v $(pwd)/routes.json:/app/routes.json \
  -v $(pwd)/templates:/app/templates \
  ghcr.io/plymouthvan/capibara:latest
```

#### Building Locally

Alternatively, build and run using the included Dockerfile:

```bash
docker build -t capibara .
docker run -p 8080:8080 --env-file .env -v $(pwd)/routes.json:/app/routes.json -v $(pwd)/templates:/app/templates capibara
```

#### Docker Compose Example

```yaml
version: '3.8'
services:
  capibara:
    image: ghcr.io/plymouthvan/capibara:latest
    ports:
      - "8080:8080"
    environment:
      - DEBUG_LOGGING=true
      - FILE_LOGGING_ENABLED=true
    volumes:
      - ./routes.json:/app/routes.json
      - ./templates:/app/templates
      - ./logs:/app/logs
    restart: unless-stopped
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

## 📄 Example Files

- [`meta.json`](./templates/meta.json) – Template for Meta Conversions API payload
- [`ga4.json`](./templates/ga4.json) – Template for GA4 Measurement Protocol forwarding

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
