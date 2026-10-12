targetScope = 'subscription'

@allowed(['dev'])
param environment string = 'dev'
param location string = 'westeurope'
@minLength(2)
@maxLength(16)
param owner string
@description('UTC expiry, supplied by the deployment wrapper; a tag is not an automatic deletion timer.')
param expiresAt string
param studentContext string = 'portfolio'
param deployApplications bool = false
param backendImage string = ''
param workerImage string = ''
param frontendImage string = ''
@minValue(1)
@maxValue(2)
param maxReplicas int = 1
@minValue(1)
@maxValue(8)
param poolSize int = 8
@secure()
@minLength(32)
param databasePassword string
@secure()
param workerServiceToken string = ''
@secure()
param metricsScrapeToken string = ''

var tags = {
  project: 'researchhub'
  environment: environment
  owner: owner
  studentContext: studentContext
  expiresAt: expiresAt
  managedBy: 'bicep'
}
resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-rh-${environment}-${owner}'
  location: location
  tags: tags
}
module foundation './modules/foundation.bicep' = {
  name: 'researchhub-foundation'
  scope: group
  params: {
    location: location
    tags: tags
    suffix: uniqueString(subscription().subscriptionId, group.name)
    databasePassword: databasePassword
  }
}
module applications './modules/applications.bicep' = if (deployApplications) {
  name: 'researchhub-applications'
  scope: group
  params: {
    location: location
    tags: tags
    environmentId: foundation.outputs.environmentId
    environmentDomain: foundation.outputs.environmentDomain
    backendImage: backendImage
    workerImage: workerImage
    frontendImage: frontendImage
    databaseHost: foundation.outputs.databaseHost
    databasePassword: databasePassword
    storageAccountName: foundation.outputs.storageAccountName
    maxReplicas: maxReplicas
    poolSize: poolSize
    workerServiceToken: workerServiceToken
    metricsScrapeToken: metricsScrapeToken
  }
}
output resourceGroupName string = group.name
output databaseHost string = foundation.outputs.databaseHost
output storageAccountName string = foundation.outputs.storageAccountName
output frontendUrl string = deployApplications ? applications!.outputs.frontendUrl : ''
