param location string
param tags object
param insightsId string
param backendId string
param databaseId string
param minimumRequests int = 20
var queries = loadJsonContent('../queries/signals.json')
var logCharts = [
  { title: 'Request rate / second', query: queries.requestRate }
  { title: '5xx percent (minimum ${minimumRequests} requests/minute)', query: replace(queries.errorRate, '__MIN_REQUESTS__', string(minimumRequests)) }
  { title: 'HTTP p95 latency (ms)', query: queries.p95Latency }
  { title: 'Hikari connections: active / max (%) per instance', query: queries.connectionPressure }
  { title: 'AI mean latency (ms, weighted timer sum/count)', query: queries.aiLatency }
  { title: 'Terminal failed processing jobs (shared queue)', query: queries.processingFailures }
  { title: 'Sandbox failures / unavailable (execution stays disabled)', query: queries.sandboxFailures }
]
var platformCharts = [
  { title: 'Backend replicas', id: backendId, namespace: 'Microsoft.App/containerapps', metric: 'Replicas', aggregation: 4 }
  { title: 'Backend CPU (nanocores)', id: backendId, namespace: 'Microsoft.App/containerapps', metric: 'UsageNanoCores', aggregation: 4 }
  { title: 'Backend memory (bytes)', id: backendId, namespace: 'Microsoft.App/containerapps', metric: 'WorkingSetBytes', aggregation: 4 }
  { title: 'Database active connections', id: databaseId, namespace: 'Microsoft.DBforPostgreSQL/flexibleServers', metric: 'active_connections', aggregation: 4 }
  { title: 'Database CPU (%)', id: databaseId, namespace: 'Microsoft.DBforPostgreSQL/flexibleServers', metric: 'cpu_percent', aggregation: 4 }
  { title: 'Database storage (%)', id: databaseId, namespace: 'Microsoft.DBforPostgreSQL/flexibleServers', metric: 'storage_percent', aggregation: 4 }
]
var logParts = [for (chart, index) in logCharts: {
          position: { x: (index % 3) * 6, y: (index / 3) * 4, colSpan: 6, rowSpan: 4 }
          metadata: {
            type: 'Extension/AppInsightsExtension/PartType/AnalyticsPart'
            inputs: [
              { name: 'ComponentId', value: { SubscriptionId: subscription().subscriptionId, ResourceGroup: resourceGroup().name, Name: last(split(insightsId, '/')), ResourceId: insightsId } }
              { name: 'Query', value: '${chart.query} | render timechart' }
              { name: 'PartTitle', value: chart.title }
              { name: 'TimeSpan', value: 'PT30M' }
              { name: 'Version', value: '1.0' }
            ]
          }
        }]
var platformParts = [for (chart, index) in platformCharts: {
          position: { x: (index % 3) * 6, y: 12 + (index / 3) * 4, colSpan: 6, rowSpan: 4 }
          metadata: {
            type: 'Extension/Microsoft_Azure_Monitoring/PartType/MetricsChartPart'
            inputs: [{ name: 'options', value: {
              chart: {
                title: chart.title
                metrics: [{ resourceMetadata: { id: chart.id }, name: chart.metric, namespace: chart.namespace, aggregationType: chart.aggregation }]
                visualization: { chartType: 2 }
              }
            } }]
          }
        }]
resource dashboard 'Microsoft.Portal/dashboards@2020-09-01-preview' = {
  name: 'dashboard-rh-staging'
  location: location
  tags: union(tags, { 'hidden-title': 'ResearchHub staging operations' })
  properties: {
    lenses: [
      {
        order: 0
        parts: concat(logParts, platformParts)
      }
    ]
    metadata: { model: { timeRange: { value: { relative: { duration: 30, timeUnit: 1 } }, type: 'MsPortalFx.Composition.Configuration.ValueTypes.TimeRange' } } }
  }
}
output dashboardId string = dashboard.id
