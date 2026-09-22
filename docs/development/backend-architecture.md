# Backend architecture

Rules for the Spring Boot modular monolith. Product context stays in [docs/context.md](../context.md) (sections 18, 19, and 32). REST error JSON is specified in [api-errors.md](api-errors.md). Request DTO validation, shared length limits, and the trim policy are specified in [validation.md](validation.md).

Java owns domain rules and, later, workspace authorization. Python under `ai-worker/` is outside this tree. Do not add a global `controllers`, `services`, or `repositories` package under `dev.researchhub`.

## Packages in the repository today

```text
dev.researchhub
├── BackendApplication
├── config          Spring bootstrap that is not a product module
└── shared
    ├── error       Stable API error codes and exceptions modules may throw
    ├── api         HTTP translation of those errors
    └── validation  Shared Bean Validation length limits and DTO normalization helpers
```

`dev.researchhub.config` holds cross-cutting startup configuration, including the cloud profile's required settings. It is not a dumping ground for product rules.

`shared` holds technology that more than one module needs. It does not hold workspace, document, source, or analysis behavior.

## Modules added with their first feature

Create the package when the first type for that module is added. Do not add empty directories or empty layer trees ahead of that.

| Module | Owns |
| --- | --- |
| `auth` | Authentication mechanics and session or token handling |
| `user` | User identity inside ResearchHub |
| `workspace` | Workspace aggregate, membership, and authorization decisions for workspace-owned resources |
| `document` | Collaborative report content owned by a workspace |
| `source` | Workspace source metadata and ingestion status |
| `ai` | AI request orchestration. Model calls and data processing stay outside this Java module when they belong in `ai-worker/` |
| `analysis` | Analysis artifacts, execution status, and provenance of computed results |
| `audit` | Audit events |

[docs/context.md](../context.md) section 18 also names `collaboration`, `citation`, and `comment`. Those are future modules. Add each one when its feature starts, and list it in this table in the same change. Do not create the package only to match the long-term diagram.

## Layers

A small module can keep its types directly in `dev.researchhub.<module>` until a split removes a real tangle.

When a module needs layers, use this shape and this direction only:

```text
<module>/
├── api              HTTP and request/response types
├── application      use cases
├── domain           business rules
└── infrastructure   persistence, clients, and framework adapters
```

Allowed dependencies inside one module:

- `api` may depend on `application`
- `application` may depend on `domain`
- `infrastructure` may depend on `domain` and `application`
- `domain` depends on none of `api`, `application`, or `infrastructure`

## Dependencies between packages

- A product module may depend on `dev.researchhub.shared.error`.
- A product module must not depend on another product module's `domain` or `infrastructure`.
- A dependency on another module's public application type is allowed only when this document lists it. None are listed yet.
- `shared` must not depend on `auth`, `user`, `workspace`, `document`, `source`, `ai`, `analysis`, `audit`, or the future modules above.
- `config` may use Spring and `shared`. It must not depend on a product module.
- `BackendApplication` stays in `dev.researchhub` so component scan covers `dev.researchhub` and its children. New modules belong under that root.

`shared.api` may depend on `shared.error`. `shared.error` must not depend on `shared.api`, so domain code can throw an error without importing HTTP types.

## What does not belong in shared

`shared` is for cross-cutting mechanics: the REST error contract, and later things such as identifiers or time helpers used by several modules.

These do not belong in `shared`:

- workspace roles, membership rules, or permission checks
- document structure
- source parsing
- prompts, retrieval, or citation rules
- analysis formulas or sandbox execution
- a generic base service or repository hierarchy

If a type names a product concept, it belongs in that module.

## GitHub issues

Name the owning module in the issue body:

```text
Module: auth | user | workspace | document | source | ai | analysis | audit | shared
```

Use `shared` only when the change is cross-cutting. A feature that touches a workspace resource is `workspace` even if it also returns an error from `shared`.
