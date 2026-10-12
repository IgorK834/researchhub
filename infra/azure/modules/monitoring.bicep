param location string
param tags object
param workspaceId string
param databaseId string
param alertEmail string
param p95Milliseconds int = 1500
param errorPercent int = 5
param minimumRequests int = 20
param enabled bool = false

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-rh-staging'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspaceId
    RetentionInDays: 30
    IngestionMode: 'LogAnalytics'
  }
}
resource action 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-rh-staging'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'rh-staging'
    enabled: true
    emailReceivers: [{ name: 'staging-owner', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}
var queries = loadJsonContent('../queries/signals.json')
var alerts = [
  { name: 'http-5xx', query: replace(queries.errorRate, '__MIN_REQUESTS__', string(minimumRequests)), threshold: errorPercent, severity: 2 }
  { name: 'http-p95', query: queries.p95Latency, threshold: p95Milliseconds, severity: 2 }
  { name: 'connection-pressure', query: queries.connectionPressure, threshold: 80, severity: 2 }
  { name: 'connection-waiters', query: queries.connectionWaiters, threshold: 0, severity: 2 }
  { name: 'connection-timeouts', query: queries.connectionTimeouts, threshold: 0, severity: 1 }
  { name: 'processing-failures', query: queries.processingFailures, threshold: 0, severity: 2 }
  { name: 'ai-unavailable', query: queries.aiUnavailable, threshold: 0, severity: 2 }
]
resource rules 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for item in alerts: {
  name: 'alert-rh-${item.name}'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'ResearchHub staging ${item.name}'
    enabled: enabled
    severity: item.severity
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    scopes: [insights.id]
    criteria: { allOf: [{
      query: item.query
      timeAggregation: 'Maximum'
      metricMeasureColumn: 'Signal'
      operator: 'GreaterThan'
      threshold: item.threshold
        failingPeriods: {
          numberOfEvaluationPeriods: contains(['connection-pressure', 'connection-waiters'], item.name) ? 5 : 1
          minFailingPeriodsToAlert: contains(['connection-pressure', 'connection-waiters'], item.name) ? 5 : 1
        }
    }] }
    actions: { actionGroups: [action.id] }
    autoMitigate: true
    // collect-results verifies actual telemetry before enabling these newly created rules.
    skipQueryValidation: true
  }
}]
resource storageAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-rh-db-storage'
  location: 'global'
  tags: tags
  properties: {
    description: 'PostgreSQL staging storage above 80%; no automatic scale-up'
    enabled: enabled
    severity: 1
    scopes: [databaseId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{
        name: 'storage-pressure'
        metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
        metricName: 'storage_percent'
        timeAggregation: 'Average'
        operator: 'GreaterThan'
        threshold: 80
        criterionType: 'StaticThresholdCriterion'
        skipMetricValidation: false
      }]
    }
    actions: [{ actionGroupId: action.id }]
    autoMitigate: true
  }
}
output insightsId string = insights.id
output insightsAppId string = insights.properties.AppId
@secure()
output connectionString string = insights.properties.ConnectionString
output actionGroupId string = action.id
