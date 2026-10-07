# node-atera

Comprehensive, fully-typed Node.js/TypeScript library for the Atera REST API v3.

## Features

- Complete API coverage for all 90+ Atera API endpoints
- Full TypeScript type definitions for all request/response payloads
- API key authentication: JWT keys as `Authorization: Bearer`, legacy keys as `X-API-KEY`
- Automatic pagination with async iterators
- Built-in rate limiting (700 req/min) with backoff
- Zero runtime dependencies
- Full test suite with mocked HTTP responses

## Installation

```bash
npm install node-atera
```

## Quick Start

```typescript
import { AteraClient } from 'node-atera';

const client = new AteraClient({
  apiKey: process.env.ATERA_API_KEY!,
});

// List agents
const agents = await client.agents.list({
  page: 1,
  itemsInPage: 50,
});

// Auto-paginate all tickets
for await (const ticket of client.tickets.listAll()) {
  console.log(ticket.TicketTitle);
}

// Create a ticket
const ticket = await client.tickets.create({
  TicketTitle: 'Email not working',
  CustomerID: 123,
  TicketPriority: 'High',
});
```

## API Reference

### Configuration

```typescript
const client = new AteraClient({
  apiKey: 'your-api-key',
  // Optional: custom base URL (useful for testing)
  baseUrl: 'https://app.atera.com/api/v3',
  // Optional: rate limit configuration
  rateLimit: {
    enabled: true,
    maxRequests: 700,
    windowMs: 60000,
    throttleThreshold: 0.8,
    retryAfterMs: 5000,
    maxRetries: 3,
  },
});
```

Current Atera API keys are JWTs (three base64url segments, issuer `AteraInterop`). The client sends those as `Authorization: Bearer` and does not also set `X-API-KEY`. Older static keys stay on `X-API-KEY` only. A pasted `Bearer ` prefix is stripped.

### Resources

| Resource | Methods |
|----------|---------|
| `client.agents` | list, listAll, get, getByMachineName, delete, runPowerShell |
| `client.tickets` | list, listAll, get, create, update, delete, listComments, createComment, listWorkHours, createWorkHours, listBillableDurations, listTimesheets, createTimesheet, listFilters, listStatuses |
| `client.devices` | list, listAll, get, create, update, delete |
| `client.devicesHttp` | list, listAll, create, delete |
| `client.devicesSnmp` | list, listAll, create, delete |
| `client.devicesTcp` | list, listAll, create, delete |
| `client.customers` | list, listAll, get, create, update, delete, listAgents, listAlerts |
| `client.contacts` | list, listAll, get, create, update, delete, listByCustomer |
| `client.alerts` | list, listAll, get, listByAgent, listByDevice |
| `client.customValues` | listAgentFields, listByAgent, setAgentValue, deleteAgentValue, (same for ticket, customer, contact, contract) |
| `client.contracts` | list, listAll, get, listByCustomer |
| `client.billing` | listInvoices, listInvoicesAll, getInvoice |
| `client.rates` | list, listAll, get, create, update, delete, listProducts, getProduct, listExpenses, getExpense |
| `client.knowledgeBase` | list, listAll |

### Pagination

All list methods support automatic pagination:

```typescript
// Manual pagination
const page1 = await client.agents.list({ page: 1, itemsInPage: 50 });
const page2 = await client.agents.list({ page: 2, itemsInPage: 50 });

// Auto-pagination with async iterator
for await (const agent of client.agents.listAll()) {
  console.log(agent.MachineName);
}

// Collect all items into an array
const allAgents = await client.agents.listAll().toArray();
```

### Error Handling

```typescript
import {
  AteraError,
  AteraAuthenticationError,
  AteraNotFoundError,
  AteraValidationError,
  AteraRateLimitError,
  AteraServerError,
} from 'node-atera';

try {
  await client.agents.get(99999);
} catch (error) {
  if (error instanceof AteraNotFoundError) {
    console.log('Agent not found');
  } else if (error instanceof AteraAuthenticationError) {
    console.log('Invalid API key');
  } else if (error instanceof AteraRateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}ms`);
  }
}
```

## Rate Limiting

Atera enforces a limit of 700 requests per minute. The client automatically:

1. Tracks requests within a rolling 60-second window
2. Slows down when approaching the limit (80% threshold)
3. Retries with exponential backoff on 429 responses
4. Exposes rate limiter state:

```typescript
const state = client.getRateLimiterState();
console.log(`Current rate: ${state.currentRate}`);
console.log(`Remaining requests: ${state.remainingRequests}`);
```

## Custom Values

Custom values can be set on agents, tickets, customers, contacts, and contracts:

```typescript
// List available custom fields
const fields = await client.customValues.listAgentFields();

// Set a custom value on an agent
await client.customValues.setAgentValue(agentId, {
  FieldName: 'Location',
  Value: 'Building A - Floor 3',
});

// Get all custom values for an agent
const values = await client.customValues.listByAgent(agentId);
```

## Device Monitoring

Create HTTP, SNMP, and TCP device monitors:

```typescript
// HTTP monitor
const httpMonitor = await client.devicesHttp.create({
  DeviceName: 'Company Website',
  CustomerID: 123,
  URL: 'https://example.com',
  CheckIntervalMinutes: 5,
  Timeout: 30,
});

// TCP monitor
const tcpMonitor = await client.devicesTcp.create({
  DeviceName: 'SMTP Server',
  CustomerID: 123,
  Hostname: 'mail.example.com',
  Port: 25,
});

// SNMP device
const snmpDevice = await client.devicesSnmp.create({
  DeviceName: 'Core Switch',
  CustomerID: 123,
  Hostname: 'switch.example.local',
  Port: 161,
});
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck

# Lint
npm run lint
```

## License

Apache-2.0
