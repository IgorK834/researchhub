param actionGroupId string
param alertAmountsUsd array = [5, 10, 20]
param startDate string
param endDate string

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'researchhub-staging-${groupName}'
  properties: {
    category: 'Cost'
    amount: last(alertAmountsUsd)
    timeGrain: 'Monthly'
    timePeriod: { startDate: startDate, endDate: endDate }
    filter: { tags: { name: 'validation-group', operator: 'In', values: [groupName] } }
    notifications: {
      first: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: int(alertAmountsUsd[0]) * 100 / int(last(alertAmountsUsd)), thresholdType: 'Actual', contactGroups: [actionGroupId], contactEmails: [] }
      second: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: int(alertAmountsUsd[1]) * 100 / int(last(alertAmountsUsd)), thresholdType: 'Actual', contactGroups: [actionGroupId], contactEmails: [] }
      final: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, thresholdType: 'Actual', contactGroups: [actionGroupId], contactEmails: [] }
    }
  }
}
output budgetId string = budget.id
targetScope = 'subscription'
param groupName string
