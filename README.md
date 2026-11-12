# KE&G Huddle

Live training engagement for KE&G Safety and Learning & Development. Employees scan a QR code and join on their phones with their employee ID, with no app or account. Trainers run quizzes, a word cloud, a random name wheel, Q&A and a timer from one screen. Every session builds points, attendance and dated training records with expiration tracking. Records are ready to send to HCSS Skills.

## What's in this repo

```
app/                      Website (Azure Static Web Apps)
  index.html              Trainer console (KE&G Microsoft sign-in required)
  join/                   Employee phone page (public; session code + employee ID)
  assets/                 Shared styles and console code
  staticwebapp.config.json  Sign-in, roles, and security headers
api/                      API (Azure Functions, Node 22)
  src/handlers/           Routes: employee.js, manage.js (trainers/admins), roles.js
  src/lib/live.js         Live session engine (pure, fully tested)
  src/lib/store/          Cosmos DB store (production) and memory store (local)
  src/integrations/hcss/  HCSS Skills connector (off / mock / live)
  test/                   Unit and API tests
infra/main.bicep          All Azure resources, as code
dev/                      Local dev server and a phone simulator (never deployed)
docs/                     Deployment, security, and HCSS guides
.github/workflows/        CI, app deploy, infrastructure deploy
```

## How it works

```
 Phones ──► /join (public page) ──► /api/join, /api/live/*   (signed employee token)
 Trainer ─► /     (Microsoft sign-in, trainer/admin role) ──► /api/manage/*
                                   │
                       Azure Static Web Apps (Standard)
                                   │  linked backend: only reachable through the site
                       Azure Functions (Node 22, managed identity)
                         │                 │                    │
                 Cosmos DB serverless   Key Vault      HCSS Skills API (later)
                 (no keys, RBAC only)   (secrets)      via an outbox, every 15 min
```

- **Live updates:** phones and the console check for changes every 1.5 seconds and only download data when something changed. Fifty phones is about 33 small requests a second. Each request is served from a 1-second cache, so the database sees a fraction of that.
- **No collisions:** each phone action (check-in, answer, word, question) is its own small record. Phones never edit a shared record, so 50 people answering at once can't overwrite each other. Only the trainer's commands edit the session itself, and those are protected with ETags.
- **One answer per person:** the answer's record ID is built from the question and the employee, so a second tap is ignored.
- **Safe saves:** "End & save session" closes the session first, then writes points, training records and history using IDs built from the session code. If the save is interrupted and run again, it overwrites the same records instead of making duplicates.

## Run it on your computer

Needs Node.js 20 or newer. No Azure account needed.

```bash
npm install
npm run dev
```

- Trainer console: http://localhost:4280 (you're signed in as a fake admin)
- Employee phone: http://localhost:4280/join/ (demo IDs 10001 to 10064)
- Fill the room with 50 fake phones: `npm run simulate -- --count 50`
- Run the tests: `npm test`

Local data lives in memory and resets when you stop the server.

## Deploy

See [docs/DEPLOY.md](docs/DEPLOY.md). Short version: create the Azure resource group and two app registrations, add the GitHub settings, run the **Infrastructure** workflow once, then every push to `main` deploys automatically after the tests pass.

## Security

See [docs/SECURITY.md](docs/SECURITY.md).

## HCSS Skills

See [docs/HCSS.md](docs/HCSS.md). The connector is built and tested in mock mode, and it's off by default. Passed trainings for modules with an HCSS course code queue up now and send once it's turned on.

## Before real use

- Safety reviews every quiz question (they are starter content).
- Confirm expiration periods and passing scores for each training module.
- Decide whether the employee ID in Huddle is the HCSS employee code or the HeavyJob payroll code.
