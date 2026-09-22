# Validation

How Jakarta Bean Validation is used at the REST boundary, how that relates to invariants
enforced deeper in a module, and the shared length limits every module reuses instead of
inventing new numbers.

REST error shape for a failed validation: [api-errors.md](api-errors.md). Module and
package placement: [backend-architecture.md](backend-architecture.md).

## API boundary

Controllers validate request DTOs with `@Valid @RequestBody`. Query and path parameters
that need validation use `@Validated` on the controller class together with constraints on
the parameter.

`dev.researchhub.shared.api.GlobalExceptionHandler` maps the resulting
`MethodArgumentNotValidException`, `ConstraintViolationException`, and
`HandlerMethodValidationException` to the standard `400 VALIDATION_FAILED` body with an
`errors[]` list of `{ field, message }`. Add a new DTO constraint by annotating the field;
no change to the exception handler is needed.

## DTO validation is not the source of truth

Bean Validation on a DTO is a fast, field-level check at the HTTP boundary. It is not a
substitute for invariants enforced by the module that owns the concept.

Once a module has `domain` or `application` layers (see backend-architecture.md), that code
must enforce its own critical rules independently of the controller, because:

- Not every caller of `application`/`domain` code arrives through a validated DTO.
  Background jobs, event handlers, and other in-process calls can build or pass domain
  objects directly.
- A constraint annotation can be loosened or dropped from a DTO by accident. If the only
  place a rule is checked is the controller, that mistake ships silently.

Concretely: a future `CreateWorkspaceRequest` DTO enforces `@NotBlank @Size(max =
FieldLengths.NAME_MAX)` on `name` for a fast 400 response. The `Workspace` domain type (or
the `workspace` module's application service) still validates its own name invariant when
constructing or renaming a workspace, so the rule holds regardless of caller. Today, before
any product module exists, this pattern is demonstrated only at the API boundary; apply the
same shared limits and the same expectation to domain code as soon as a module's domain
layer exists.

## Shared length limits

Defined in `dev.researchhub.shared.validation.FieldLengths`, before any database column
exists, so every module reuses the same numbers on its request DTOs. When a module later
adds a table for one of these concepts, the column length must be at least this large.

| Constant | Max length | Used for |
| --- | --- | --- |
| `FieldLengths.NAME_MAX` | 255 | Short display names: workspace names, user display names, and similar identifiers |
| `FieldLengths.TITLE_MAX` | 500 | Document and other titles |
| `FieldLengths.PROMPT_MAX` | 8000 | AI user prompts |
| `FieldLengths.COMMENT_MAX` | 4000 | Comment bodies |

Do not hardcode a new max length for one of these concepts in a module DTO. Import the
constant from `shared.validation` instead, so a future change to a limit happens in one
place.

## Trim policy

Leading and trailing whitespace on user-entered identifiers and names is stripped before
Bean Validation runs, using `dev.researchhub.shared.validation.Normalize#trim(String)` in
the DTO's record compact constructor:

```java
public record CreateWorkspaceRequest(
        @NotBlank @Size(max = FieldLengths.NAME_MAX) String name
) {
    public CreateWorkspaceRequest {
        name = Normalize.trim(name);
    }
}
```

The compact constructor runs before field-level constraints are checked, so a
whitespace-only value becomes an empty string and is rejected by `@NotBlank` as blank,
rather than being silently accepted as invisible content. Apply this to name- and
title-like fields; it is not needed for values where surrounding whitespace is meaningful
(for example, a code block inside a longer body).

## Where this is demonstrated today

No product module DTO exists yet. The pattern above is demonstrated end-to-end by
`dev.researchhub.shared.api.ErrorHandlingTestController.NameBody`
(`backend/src/test/java`) and exercised in
`GlobalExceptionHandlerIntegrationTest`, covering:

- a blank field (`must not be blank`),
- a whitespace-only field that becomes blank after trimming,
- a field over its configured max length (`size must be between 0 and 255`),
- a field with surrounding whitespace that is trimmed before it reaches the handler.

When the first real module DTO is added, reuse `FieldLengths` and the trim pattern above
instead of copying literals or writing a new normalization helper.
