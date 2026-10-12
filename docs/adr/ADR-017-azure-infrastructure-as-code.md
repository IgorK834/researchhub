# ADR-017: Bicep for disposable Azure infrastructure

- Status: Accepted
- Date: 2026-10-12
- Backlog: RH-201 (Task 21.2); depends on RH-200 / Task 21.1
- RH-350 prerequisites: Task 21.1 is recorded in ADR-010, Task 16.1 in ADR-007, and Task 14.3 in ADR-008; the deferred capabilities do not become implemented by documenting those dependencies.
- Implementation trigger: the `dev` IaC is delivered now; actual provisioning needs a selected subscription, private credentials and a bounded validation window. Staging/production expansion requires new parameters, cost review and cloud evidence.

## Choice

| Criterion | Bicep | Terraform |
| --- | --- | --- |
| Azure educational goals | Native Azure resource types, ARM validation/what-if; selected | Azure provider abstraction; useful but unnecessary here |
| State | Azure Resource Manager tracks resources; no separate local state backend | Requires protected state, locking and lifecycle decisions; state can contain credentials |
| Reproducibility | Pinned compiler 0.48.1, explicit stable resource API versions, local modules | Provider/version lock and backend setup would be additional moving parts |
| Other clouds | Azure-specific by design | Prefer if a real multi-cloud requirement arrives |

Use [Bicep](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/overview). Maintain
subscription-scoped `infrastructure/main.bicep`, local `modules/` and a public `environments/dev.json`.
No secret files, model API keys or generated ARM parameter files are committed. No Terraform state,
ACR, Key Vault or extra managed services are needed for this dev foundation. Existing images are published
separately to a public registry and supplied by digest; publication is not performed by this change.

## Contracts and limits

The documented Node wrapper is the supported entrypoint. It rejects unknown fields, non-dev environments,
invalid aliases, mutable image tags, reused/short credentials and connection-budget overflow **before Azure**.
It adds an explicit expiry and secure parameters in a mode-0600 temporary file, invokes ARM validation,
then what-if or deployment, and removes the file even on failure. Credentials are absent from argv/logging.
Do not bypass the wrapper: native ARM parameter decorators do not enforce the derived connection budget.

Resource names are deterministic: `rg-rh-dev-<owner>` and a `uniqueString(subscription ID, RG name)`
suffix for globally unique PostgreSQL/Storage names. Tags identify project, environment, owner alias,
student context, expiry and Bicep management. Changing location/owner is a new fixture, not an in-place
production move. Use different aliases for independent fixtures in one subscription.

Foundation: private PostgreSQL 17 B1ms/32 GiB, VECTOR allowlist and an empty product database, authenticated
Blob container, VNet/private DNS, Consumption Container Apps environment and capped Log Analytics.
No tables are created in IaC: backend Flyway owns every existing migration and JPA validates it.
An optional module deploys the internal Spring backend, internal deterministic worker and public static
Caddy frontend; sessions/quotas remain PostgreSQL-backed. Collaboration and sandbox are explicitly off.

Default backend max 1 plus rollout surge 1, pool 8 and scheduler allowance 2 budgets 20 connections,
below `floor(0.8*(50-15))=28`. For max 2, reduce pool to 6 to budget 24 with surge. Defaults are planning
assumptions, not a measured server limit: verify server reserved limits/other consumers during validation.
The worker stays warm because current processing is synchronous HTTP from a scheduled dispatcher.
Scale-to-zero is supported for the frontend; it is not promised for every component.

The current Blob adapter needs a connection string generated inside ARM from `listKeys()` and held in
Container Apps secrets. Managed identity, Key Vault references, least-privilege application database roles,
production HA, restore validation, autoscaling policy and full hosted onboarding remain follow-ups.
Secure parameters reduce credential exposure but are not a delivered production secret-rotation design.
Removing a module or setting `deployApplications=false` in incremental ARM mode does **not** delete
existing apps. Tear down the whole disposable group using the runbook.

## Verification and evidence

Offline tests cover validation, private temporary parameters/cleanup, Azure argument routing and compiled
resource/security contracts. The compiler and linter check every module without Azure credentials. Node
coverage for the deployment logic is gated at >=80% lines/branches/functions; Bicep has no executable
line-coverage metric. Backend runtime/profile tests retain their existing coverage gates.

Successful local checks are not proof that a subscription can provision these resources. Record provider
registration/region/SKU availability, ARM validation/what-if, actual deployment, Flyway, health and authorized
smoke results before stating cloud acceptance. [Runbook](../../infrastructure/README.md) documents commands,
cleanup and that live cloud validation is still pending. Resource diagram/cost classification:
[ADR-010](ADR-010-deployment-topology.md). Portfolio claims: [case study](../case-study.md).
