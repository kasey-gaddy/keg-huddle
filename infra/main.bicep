// KE&G Huddle - Azure infrastructure
//
// Static Web App (Standard)  ->  linked Function App (Node 22, managed identity)
//                                   -> Cosmos DB serverless (no keys; Entra RBAC only)
//                                   -> Key Vault (token signing key, HCSS secret)
//                                   -> Application Insights
//
// Deploy with the "Infrastructure" GitHub workflow or:
//   az deployment group create -g <rg> -f infra/main.bicep -p @infra/main.parameters.json

targetScope = 'resourceGroup'

@description('Short name used in every resource name.')
param prefix string = 'keghuddle'

@description('Region for the Function App, Cosmos DB, Key Vault and monitoring.')
param location string = resourceGroup().location

@description('Static Web Apps is only offered in some regions.')
@allowed(['centralus', 'eastus2', 'westus2', 'westeurope', 'eastasia'])
param swaLocation string = 'centralus'

@description('Entra ID (Azure AD) tenant ID for KE&G. Only accounts from this tenant get roles.')
param tenantId string = subscription().tenantId

@description('App registration (client) ID used for trainer sign-in.')
param aadClientId string

@secure()
@description('App registration client secret used for trainer sign-in.')
param aadClientSecret string

@secure()
@description('Random 64+ character string. Signs employee session tokens. Rotate by changing it.')
param tokenSigningKey string

@description('Comma-separated emails with the admin role.')
param adminEmails string

@description('Comma-separated emails with the trainer role.')
param trainerEmails string = ''

@allowed(['off', 'mock', 'live'])
param hcssMode string = 'off'

@description('HCSS client ID (leave blank until HCSS is connected).')
param hcssClientId string = ''

@secure()
@description('HCSS client secret (leave blank until HCSS is connected).')
param hcssClientSecret string = ''

var suffix = uniqueString(resourceGroup().id)
var names = {
  logs: '${prefix}-logs'
  appi: '${prefix}-appi'
  storage: take(toLower('${prefix}fn${suffix}'), 24)
  cosmos: toLower('${prefix}-db-${suffix}')
  kv: take('${prefix}-kv-${suffix}', 24)
  plan: '${prefix}-plan'
  func: '${prefix}-api-${suffix}'
  swa: '${prefix}-web'
}
var tags = { app: 'keg-huddle', owner: 'KE&G Marketing and Communications' }

/* ---------- monitoring ---------- */
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: names.logs
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}
resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: names.appi
  location: location
  kind: 'web'
  tags: tags
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

/* ---------- storage for the Functions host (no app data lives here) ---------- */
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: names.storage
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true // required by the Windows Consumption plan content share
  }
}
var storageConn = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'

/* ---------- Cosmos DB (serverless, keys disabled) ---------- */
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: names.cosmos
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [{ locationName: location, failoverPriority: 0 }]
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    disableLocalAuth: true // only Entra ID (managed identity) can read or write data
    minimalTlsVersion: 'Tls12'
    backupPolicy: { type: 'Continuous', continuousModeProperties: { tier: 'Continuous7Days' } }
  }
}
resource db 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'huddle'
  properties: { resource: { id: 'huddle' } }
}
resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: db
  name: 'items'
  properties: {
    resource: {
      id: 'items'
      partitionKey: { paths: ['/pk'], kind: 'Hash' }
      indexingPolicy: { indexingMode: 'consistent', includedPaths: [{ path: '/pk/?' }, { path: '/type/?' }], excludedPaths: [{ path: '/*' }] }
    }
  }
}

/* ---------- Key Vault ---------- */
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.kv
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
    enablePurgeProtection: true
  }
}
resource secretToken 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'token-signing-key'
  properties: { value: tokenSigningKey }
}
resource secretHcss 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'hcss-client-secret'
  properties: { value: empty(hcssClientSecret) ? 'not-set' : hcssClientSecret }
}

/* ---------- Function App (Windows Consumption, Node 22) ---------- */
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: names.plan
  location: location
  tags: tags
  sku: { name: 'Y1', tier: 'Dynamic' }
  properties: {}
}
resource func 'Microsoft.Web/sites@2023-12-01' = {
  name: names.func
  location: location
  tags: tags
  kind: 'functionapp'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    keyVaultReferenceIdentity: 'SystemAssigned'
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      nodeVersion: '~22'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: storageConn }
        { name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', value: storageConn }
        { name: 'WEBSITE_CONTENTSHARE', value: toLower(names.func) }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString }
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        { name: 'COSMOS_DATABASE', value: 'huddle' }
        { name: 'COSMOS_CONTAINER', value: 'items' }
        { name: 'TOKEN_SIGNING_KEY', value: '@Microsoft.KeyVault(SecretUri=${secretToken.properties.secretUri})' }
        { name: 'APP_TIMEZONE', value: 'America/Phoenix' }
        { name: 'ADMIN_EMAILS', value: adminEmails }
        { name: 'TRAINER_EMAILS', value: trainerEmails }
        { name: 'ALLOWED_TENANT_ID', value: tenantId }
        { name: 'HCSS_MODE', value: hcssMode }
        { name: 'HCSS_MAPPING_VERIFIED', value: 'false' }
        { name: 'HCSS_EMPLOYEE_KEY', value: 'employeeCode' }
        { name: 'HCSS_CLIENT_ID', value: hcssClientId }
        { name: 'HCSS_CLIENT_SECRET', value: '@Microsoft.KeyVault(SecretUri=${secretHcss.properties.secretUri})' }
        { name: 'HCSS_SCOPES', value: 'skills:read skills:write' }
      ]
    }
  }
}
// Turn off basic-auth publishing; deployments use Entra ID (GitHub OIDC).
resource ftpPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: func
  name: 'ftp'
  properties: { allow: false }
}
resource scmPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: func
  name: 'scm'
  properties: { allow: false }
}

/* ---------- role assignments for the Function App identity ---------- */
resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, func.id, 'data-contributor')
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002' // Cosmos DB Built-in Data Contributor
    principalId: func.identity.principalId
    scope: cosmos.id
  }
}
resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, func.id, 'kv-secrets-user')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: func.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

/* ---------- Static Web App (Standard) with the Function App linked ---------- */
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: names.swa
  location: swaLocation
  tags: tags
  sku: { name: 'Standard', tier: 'Standard' }
  properties: { stagingEnvironmentPolicy: 'Disabled', allowConfigFileUpdates: true }
}
resource swaSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    AAD_CLIENT_ID: aadClientId
    AAD_CLIENT_SECRET: aadClientSecret
  }
}
resource backend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: swa
  name: 'api'
  properties: { backendResourceId: func.id, region: location }
}

output staticWebAppName string = swa.name
output siteUrl string = 'https://${swa.properties.defaultHostname}'
output functionAppName string = func.name
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output keyVaultName string = kv.name
