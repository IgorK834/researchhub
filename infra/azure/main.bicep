targetScope = 'resourceGroup'
@allowed(['staging'])
param environment string = 'staging'
param location string = resourceGroup().location
param owner string
param ttl string
param commit string
param migrationVersion string
param timestamp string
param alertEmail string
param clientCidr string
param backendImage string = ''
param workerImage string = ''
param frontendImage string = ''
param backendDigest string = ''
param workerDigest string = ''
param frontendDigest string = ''
param deployApplications bool = false
@allowed(['disabled', 'open'])
param registrationMode string = 'disabled'
@allowed([1, 2])
param replicas int = 1
@allowed([5])
param poolSize int = 5
param p95Milliseconds int = 1500
param errorPercent int = 5
param minimumRequests int = 20
param budgetAlertsUsd array = [5, 10, 20]
param budgetStart string
param budgetEnd string
@secure()
param databasePassword string
@secure()
param workerToken string
@secure()
param metricsToken string

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().name)
var tags = {
  project: 'researchhub'
  environment: environment
  owner: owner
  purpose: 'ephemeral-validation'
  'managed-by': 'bicep'
  ttl: ttl
  commit: commit
  migration: migrationVersion
  'deployment-at': timestamp
  'image-backend': backendDigest
  'image-worker': workerDigest
  'image-frontend': frontendDigest
  'validation-group': resourceGroup().name
}
module foundation '../../infrastructure/modules/foundation.bicep' = {
  name: 'staging-foundation'
  params: { location: location, tags: tags, suffix: suffix, databasePassword: databasePassword }
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acrrh${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}
resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'identity-rh-staging-pull'
  location: location
  tags: tags
}
resource pullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, pullIdentity.id, 'AcrPull')
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
module monitoring './modules/monitoring.bicep' = {
  name: 'staging-monitoring'
  params: { location: location, tags: tags, workspaceId: foundation.outputs.logsId, databaseId: foundation.outputs.databaseId
    alertEmail: alertEmail, p95Milliseconds: p95Milliseconds, errorPercent: errorPercent, minimumRequests: minimumRequests }
}
module budget './modules/budget.bicep' = {
  name: 'staging-budget'
  scope: subscription()
  params: { groupName: resourceGroup().name, actionGroupId: monitoring.outputs.actionGroupId, alertAmountsUsd: budgetAlertsUsd, startDate: budgetStart, endDate: budgetEnd }
}
module applications './modules/applications.bicep' = if (deployApplications) {
  name: 'staging-applications'
  params: {
    location: location
    tags: tags
    environmentId: foundation.outputs.environmentId
    environmentDomain: foundation.outputs.environmentDomain
    databaseHost: foundation.outputs.databaseHost
    databasePassword: databasePassword
    storageAccountName: foundation.outputs.storageAccountName
    registryServer: registry.properties.loginServer
    pullIdentityId: pullIdentity.id
    backendImage: backendImage
    workerImage: workerImage
    frontendImage: frontendImage
    workerServiceToken: workerToken
    metricsScrapeToken: metricsToken
    appInsightsConnectionString: monitoring.outputs.connectionString
    commit: commit
    backendDigest: backendDigest
    registrationMode: registrationMode
    clientCidr: clientCidr
    replicas: replicas
    poolSize: poolSize
  }
  dependsOn: [pullRole]
}
module dashboard './modules/dashboard.bicep' = {
  name: 'staging-dashboard'
  params: { location: location, tags: tags, insightsId: monitoring.outputs.insightsId
    backendId: resourceId('Microsoft.App/containerApps', 'ca-rh-backend'), databaseId: foundation.outputs.databaseId, minimumRequests: minimumRequests }
}
output registryName string = registry.name
output registryServer string = registry.properties.loginServer
output insightsAppId string = monitoring.outputs.insightsAppId
output insightsId string = monitoring.outputs.insightsId
output workspaceId string = foundation.outputs.logsWorkspaceId
output databaseId string = foundation.outputs.databaseId
output backendId string = resourceId('Microsoft.App/containerApps', 'ca-rh-backend')
output frontendUrl string = deployApplications ? applications!.outputs.frontendUrl : ''
output dashboardId string = dashboard.outputs.dashboardId
