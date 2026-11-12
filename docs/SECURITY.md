# Security

## Who can do what

| Who | How they get in | What they can do |
|---|---|---|
| Employee | Session code on the screen + their employee ID | Join that one session; answer, send words, ask questions; see their own points. Nothing else. |
| Trainer | KE&G Microsoft account + listed in `TRAINER_EMAILS` | Run sessions, build rosters, view records and reports |
| Admin | KE&G Microsoft account + listed in `ADMIN_EMAILS` | Everything trainers can do, plus edit training modules, point rules, delete rosters/modules, send to HCSS |

Sign-in is locked to the KE&G Entra ID tenant in two places: the sign-in provider (`staticwebapp.config.json`) and the role check (`ALLOWED_TENANT_ID`). A personal Microsoft account gets no role, even if its email matches.

Every API route declares its access level in one table (`api/src/handlers/*.js`). One wrapper (`api/src/lib/http.js`) enforces it before any handler code runs, so a route can't accidentally skip the check.

## Employees

- Employees have no passwords. Joining requires a live 6-digit session code and an employee ID that exists in Huddle.
- A successful join returns a token signed with a key kept in Key Vault. It works for that one session only and expires after 12 hours.
- Wrong codes and wrong IDs are limited per network: 25 failures in 10 minutes blocks that network for a while. Successful joins are not limited that way, because a whole crew on jobsite Wi-Fi shares one IP address.
- Phones never receive the correct answer while a question is open, and never see anyone else's answers.
- **Anonymous questions:** the asker's ID is stored so they get points and can see their own question. It is never sent to the trainer screen, other phones, or reports. Admins with direct database access could see it. If that's not acceptable, we can stop storing it and drop points for anonymous questions.

**Known limit:** anyone who knows a live session code and a valid employee ID could join as that person. That's the same trade-off as a paper sign-in sheet. If it becomes a problem, add a second factor such as the last 4 digits of their phone number or a PIN from BDL People.

## Data and secrets

- **Cosmos DB has key-based access turned off.** Only the Function App's managed identity can read or write data. No database password exists to leak.
- **Secrets live only in Key Vault:** the token signing key and the HCSS client secret. The Function App reads them through Key Vault references.
- **GitHub stores no Azure passwords.** Deployments sign in with OpenID Connect (federated credentials). Basic-auth publishing on the Function App is turned off.
- **The API is a linked backend.** It only accepts traffic routed through the Static Web App, so the sign-in header can't be faked by calling the Function App directly.
- Personal data stored: employee ID, name, crew, points, training results, questions asked. No phone numbers, emails or SSNs for employees.
- Continuous backup on Cosmos DB (7-day point-in-time restore).

## Browser protections

Set in `staticwebapp.config.json` and applied locally by the dev server too:

- A strict Content Security Policy: scripts only from this site, no inline scripts, and API calls only to this site.
- The site can't be embedded in another site's frame.
- HTTPS is enforced with HSTS, and the browser is told not to guess content types.
- Everything user-typed is escaped before it's shown.
- CSV exports block spreadsheet formula injection.

## Inputs

All text is trimmed, stripped of control characters and length-capped on the server:

| Field | Limit |
|---|---|
| Word cloud entry | 30 characters, 10 per person |
| Question | 240 characters, 10 per person per session |
| Quiz answer | Must match an open question and a real choice |
| Request body | 256 KB |
| Bulk import | 2,000 rows |

## Recommended next steps

1. Put Azure Front Door with WAF rate limiting in front of the site. The built-in limiter counts per server instance; a WAF limit is shared across all of them.
2. Turn on Microsoft Defender for Cloud for the subscription.
3. Add required reviewers to the `production` environment in GitHub, and protect the `main` branch so changes need a pull request and passing CI.
4. When BDL People is ready, replace the email lists with an Entra ID security group for trainers and admins.
