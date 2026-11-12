# HCSS Skills connection

## The plan

HCSS Skills stays the system of record for certifications. Huddle delivers and scores the training, then writes passed completions into HCSS Skills, so foremen see them where they already look.

```
End & save session
   └─► training record saved in Huddle (always)
         └─► if passed AND the module has an HCSS course code:
               outbox item "pending"
                  └─► every 15 minutes (or "Send now"): HCSS Skills import
                        └─► outbox item and training record marked "sent" or "failed"
```

Huddle never calls HCSS while a session is ending, so a slow or down HCSS can't affect a training. Failed sends retry up to 5 times. Everything queued while the connection is off sends once it's turned on.

## What's built now

- An **HCSS course code** field on each training module (Trainings > Training modules).
- An outbox that records every passed completion that should go to HCSS.
- The **HCSS** column in Training records: Queued, In HCSS, or Failed.
- `api/src/integrations/hcss/liveClient.js`: an OAuth client-credentials sign-in and a call to the documented import endpoint `POST /skills/api/v1/employeeSkills/import`.
- Three modes, set with the `HCSS_MODE` app setting:
  - `off` (default): items stay queued.
  - `mock`: items are marked sent without calling HCSS. Use this for demos and testing.
  - `live`: sends to HCSS. Blocked unless `HCSS_MAPPING_VERIFIED=true`.

## Go-live checklist

1. **Get API access.** Ask the HCSS account rep to enable API access for the Skills API.
2. **Create the client.** An HCSS admin creates a client in HCSS Credentials > Product Setup with the `skills:read skills:write` scopes. Put the client ID in the `HCSS_CLIENT_ID` GitHub variable and the secret in the `HCSS_CLIENT_SECRET` GitHub secret, then re-run the Infrastructure workflow. The secret goes into Key Vault.
3. **Decide how employees are matched.** HCSS matches by employee code by default, or by HeavyJob payroll code. Set `HCSS_EMPLOYEE_KEY` to `employeeCode` or `payrollCode`. The employee IDs in Huddle must equal that value.
4. **Verify the field mapping.** HCSS's public docs don't show the full import body. Sign in to the HCSS developer portal, open the Skills API spec, and confirm the field names in `toHcss()` in `liveClient.js` (course code, completion date, expiration date). Also check whether HCSS sets expiration from the skill's own rule. If it does, stop sending ours.
5. **Test against a sandbox** or a test employee. Then set `HCSS_MAPPING_VERIFIED=true` and `HCSS_MODE=live`.
6. **Add HCSS course codes** to each training module that should create an HCSS skill. Modules without a code stay in Huddle only (good for tailgate refreshers).

## Later

- Read HCSS Skills back on a schedule, using the documented `dateAfterUtc` filter, so Huddle also shows certifications earned elsewhere.
- Pull employees from HCSS instead of uploading CSVs.
- A "Build a retake roster from skills expiring in 60 days" button.
