# Deploying to Azure

This is a one-time setup. After it, every push to `main` deploys automatically once the tests pass.

You need Owner (or Contributor + User Access Administrator) on an Azure subscription, and someone who can create app registrations in Entra ID.

## 1. Create the resource group

```bash
az group create --name rg-keg-huddle --location centralus
```

## 2. App registration for trainer sign-in

1. Go to Entra ID > App registrations > New registration.
   - Name: `KE&G Huddle sign-in`
   - Supported account types: **this organizational directory only**
   - Redirect URI (Web): `https://<your-site>/.auth/login/kegtus/callback`. You'll get the site address after step 5, so come back and add it then.
2. Under Certificates & secrets, create a client secret. Copy the value.
3. Note the **Application (client) ID**.

## 3. App registration for GitHub deployments (no passwords)

1. Create another app registration: `KE&G Huddle GitHub deploy`.
2. Under Certificates & secrets > Federated credentials > Add, choose **GitHub Actions deploying Azure resources**.
   - Organization: `kasey-gaddy`
   - Repository: `keg-huddle`
   - Entity: **Environment**, name `production`
3. In the resource group, give this app the **Contributor** and **User Access Administrator** roles. The second one is needed to create the Key Vault and Cosmos role assignments.

## 4. GitHub settings

In the repository, open Settings > Secrets and variables > Actions.

**Variables:**

| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the GitHub deploy app (step 3) |
| `AZURE_TENANT_ID` | KE&G tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID |
| `RESOURCE_GROUP` | `rg-keg-huddle` |
| `LOGIN_CLIENT_ID` | Client ID of the sign-in app (step 2) |
| `ADMIN_EMAILS` | Comma-separated admin emails |
| `TRAINER_EMAILS` | Comma-separated trainer emails |
| `HCSS_CLIENT_ID` | Leave empty for now |

**Secrets:**

| Name | Value |
|---|---|
| `LOGIN_CLIENT_SECRET` | Client secret from step 2 |
| `TOKEN_SIGNING_KEY` | A long random string. Generate one with `openssl rand -hex 48` |
| `HCSS_CLIENT_SECRET` | Leave empty for now |

Also create the environment **production** under Settings > Environments. Add yourself as a required reviewer so nothing deploys without approval.

## 5. Create the Azure resources

Actions > **Infrastructure** > Run workflow. The output lists the site URL and resource names. Then:

- Add two more GitHub variables from the output: `FUNCTION_APP_NAME` and `STATIC_WEB_APP_NAME`.
- Add the site's redirect URI to the sign-in app registration (step 2).

## 6. Deploy the app

Push to `main`, or run Actions > **Deploy app** by hand.

## 7. Custom domain (optional)

In the Static Web App, open Custom domains and add `huddle.kegtus.com`. Create the CNAME record it asks for, then add `https://huddle.kegtus.com/.auth/login/kegtus/callback` to the sign-in app registration.

## Costs (rough)

| Resource | Monthly cost |
|---|---|
| Static Web Apps Standard | about $9 |
| Functions Consumption | usually $0 (1 million free calls a month; a 1-hour, 50-person session is about 120,000 calls) |
| Cosmos DB serverless | pennies to a few dollars, depending on how many sessions you run |
| Key Vault, App Insights, Storage | a few dollars |

## Day-to-day

| Task | How |
|---|---|
| Add a trainer or admin | Update `TRAINER_EMAILS` / `ADMIN_EMAILS` and re-run Infrastructure. Or change the app setting in the Function App directly. |
| Rotate the employee token key | Change `TOKEN_SIGNING_KEY` and re-run Infrastructure. Phones in a live session would need to rejoin. |
| Logs | Application Insights `keghuddle-appi` |
