param location string
param tags object
param environmentId string
param environmentDomain string
param backendImage string
param workerImage string
param frontendImage string
param databaseHost string
param storageAccountName string
@allowed([5])
param poolSize int = 5
param commit string
param backendDigest string
param registrationMode string
param clientCidr string
param registryServer string
param pullIdentityId string
@allowed([1, 2])
param replicas int
@secure()
param appInsightsConnectionString string
@secure()
param databasePassword string
@secure()
param workerServiceToken string
@secure()
param metricsScrapeToken string

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: storageAccountName }
resource worker 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-rh-worker'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${pullIdentityId}': {} } }
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{ server: registryServer, identity: pullIdentityId }]
      ingress: { external: false, targetPort: 8090, transport: 'http', allowInsecure: false }
      secrets: [{ name: 'worker-token', value: workerServiceToken }]
    }
    template: {
      containers: [{
        name: 'worker'
        image: workerImage
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'AI_WORKER_SERVICE_TOKEN', secretRef: 'worker-token' }
          { name: 'AI_WORKER_MODEL_PROVIDER', value: 'deterministic' }
          { name: 'AI_WORKER_EMBEDDING_PROVIDER', value: 'deterministic' }
        ]
        probes: [
          { type: 'Liveness', httpGet: { path: '/health', port: 8090 }, initialDelaySeconds: 30, periodSeconds: 10 }
          { type: 'Readiness', httpGet: { path: '/health', port: 8090 }, periodSeconds: 10 }
        ]
      }]
      // The synchronous caller has a timeout; scale-to-zero cold starts need separate validation.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}
resource backend 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-rh-backend'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${pullIdentityId}': {} } }
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{ server: registryServer, identity: pullIdentityId }]
      // /internal/** must never be reachable from the public internet.
      ingress: { external: false, targetPort: 8080, transport: 'http', allowInsecure: false }
      secrets: [
        { name: 'database-password', value: databasePassword }
        { name: 'worker-token', value: workerServiceToken }
        { name: 'metrics-token', value: metricsScrapeToken }
        { name: 'app-insights', value: appInsightsConnectionString }
        { name: 'blob-connection', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
      ]
    }
    template: {
      containers: [{
        name: 'backend'
        image: backendImage
        resources: { cpu: json('1.0'), memory: '2Gi' }
        env: [
          { name: 'SPRING_PROFILES_ACTIVE', value: 'azure' }
          { name: 'DEPLOYMENT_COMMIT', value: commit }
          { name: 'DEPLOYMENT_IMAGE_DIGEST', value: backendDigest }
          { name: 'DEPLOYMENT_REQUIRE_IDENTITY', value: 'true' }
          { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'app-insights' }
          { name: 'APPLICATIONINSIGHTS_CONFIGURATION_CONTENT', value: string({role:{name:'researchhub-backend'},sampling:{percentage:100},metricIntervalSeconds:60,instrumentation:{micrometer:{enabled:true},logging:{level:'OFF'}},customDimensions:{'service.version':commit},selfDiagnostics:{destination:'console',level:'WARN'}}) }
          { name: 'JAVA_TOOL_OPTIONS', value: '-javaagent:/opt/observability/applicationinsights-agent.jar' }
          { name: 'DB_URL', value: 'jdbc:postgresql://${databaseHost}:5432/researchhub?sslmode=verify-full&sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory' }
          { name: 'DB_USER', value: 'researchhub' }
          { name: 'DB_PASSWORD', secretRef: 'database-password' }
          { name: 'DB_POOL_MAX_SIZE', value: string(poolSize) }
          { name: 'DB_POOL_MIN_IDLE', value: '1' }
          { name: 'DB_POOL_LEAK_DETECTION_THRESHOLD_MS', value: '20000' }
          { name: 'BLOB_ENDPOINT', value: storage.properties.primaryEndpoints.blob }
          { name: 'BLOB_CONTAINER_NAME', value: 'researchhub-sources' }
          { name: 'BLOB_AUTH', value: 'connection-string' }
          { name: 'BLOB_CONNECTION_STRING', secretRef: 'blob-connection' }
          { name: 'AI_WORKER_BASE_URL', value: 'https://${worker.properties.configuration.ingress.fqdn}' }
          { name: 'AI_WORKER_SERVICE_TOKEN', secretRef: 'worker-token' }
          { name: 'METRICS_SCRAPE_TOKEN', secretRef: 'metrics-token' }
          { name: 'REGISTRATION_MODE', value: registrationMode }
          { name: 'COLLABORATION_ENABLED', value: 'false' }
          { name: 'ANALYSIS_SANDBOX_ENABLED', value: 'false' }
          { name: 'FORWARD_HEADERS_STRATEGY', value: 'none' }
          // HTTPS upstream routing changes Host; authorize only the public edge origin in Spring CORS.
          { name: 'CORS_ALLOWED_ORIGINS', value: 'https://ca-rh-frontend.${environmentDomain}' }
        ]
        probes: [
          { type: 'Startup', httpGet: { path: '/actuator/health/liveness', port: 8080 }, periodSeconds: 10, failureThreshold: 30 }
          { type: 'Liveness', httpGet: { path: '/actuator/health/liveness', port: 8080 }, periodSeconds: 10 }
          { type: 'Readiness', httpGet: { path: '/actuator/health/readiness', port: 8080 }, periodSeconds: 10 }
        ]
      }]
      scale: { minReplicas: replicas, maxReplicas: replicas }
    }
  }
}
resource frontend 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-rh-frontend'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${pullIdentityId}': {} } }
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{ server: registryServer, identity: pullIdentityId }]
      ingress: { external: true, targetPort: 8080, transport: 'http', allowInsecure: false, ipSecurityRestrictions: [{ name: 'validation-client', action: 'Allow', ipAddressRange: clientCidr }] }
    }
    template: {
      containers: [{
        name: 'frontend'
        image: frontendImage
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [{ name: 'API_UPSTREAM', value: 'https://${backend.properties.configuration.ingress.fqdn}' }]
        probes: [
          { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 10 }
          { type: 'Readiness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 10 }
        ]
      }]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '10' } } }]
      }
    }
  }
}
output frontendUrl string = 'https://${frontend.properties.configuration.ingress.fqdn}'
