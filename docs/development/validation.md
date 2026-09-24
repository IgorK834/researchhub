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

Concretely: `dev.researchhub.workspace.api.CreateWorkspaceRequest` enforces `@NotBlank @Size(max =
FieldLengths.NAME_MAX)` on `name` for a fast 400 response, and `@Size(max =
FieldLengths.DESCRIPTION_MAX)` on the optional `description`. The `Workspace` domain type
checks the same two rules again when a workspace is constructed, so they hold regardless of
caller, and `WorkspaceService` translates a domain rejection into `VALIDATION_FAILED` for
callers that never touched a DTO. `WorkspaceTest` and `WorkspaceServiceIntegrationTest`
assert both layers, which is what stops the DTO from becoming the only place a limit lives.

## Shared length limits

Defined in `dev.researchhub.shared.validation.FieldLengths`, before any database column
exists, so every module reuses the same numbers on its request DTOs. When a module later
adds a table for one of these concepts, the column length must be at least this large.

| Constant | Max length | Used for |
| --- | --- | --- |
| `FieldLengths.NAME_MAX` | 255 | Short display names: workspace names, user display names, and similar identifiers |
| `FieldLengths.EMAIL_MAX` | 254 | Email addresses, whole address including the domain |
| `FieldLengths.TITLE_MAX` | 500 | Document and other titles |
| `FieldLengths.DOCUMENT_CONTENT_MAX_BYTES` | 1000000 | Serialized size of one document's JSON content, in **bytes** |
| `FieldLengths.DESCRIPTION_MAX` | 2000 | Optional free-text descriptions: a workspace description and similar explanatory metadata |
| `FieldLengths.PROMPT_MAX` | 8000 | AI user prompts |
| `FieldLengths.COMMENT_MAX` | 4000 | Comment bodies |

`DOCUMENT_CONTENT_MAX_BYTES` is the odd one out in this table: it is a byte count, not a character count,
because what a row and a response have to carry is the encoded size, and a character limit would be the wrong
bound for prose that is mostly non-ASCII. One megabyte is far more than a report section and small enough that
a document stays a row rather than a blob. The limit exists at all because nothing else bounds it yet — there
is no chunking, no incremental update, and no CRDT, so every save sends and stores the whole document. It is
enforced in three places, each for a different reason: `JsonDocumentContent` at the HTTP boundary for a field
error naming `content`, `DocumentContent` in the domain for every other caller, and
`ck_documents_content_size` in the column for anything that reaches the database another way.

`DESCRIPTION_MAX` is 2000, deliberately far below `COMMENT_MAX`, even though both hold free text. A
description is metadata rendered next to the thing it describes, usually in a list, so it has to stay
readable at a glance; a comment is discussion and can reasonably run long. Reusing `COMMENT_MAX` for a
description would invite text no list can display, so do not silently borrow it — a new concept that
needs a different limit gets its own named constant and its own row here.

`EMAIL_MAX` is 254 because that is the longest address that can actually be delivered: RFC 5321 caps a `MAIL FROM` path at 256 characters including the angle brackets. The 320 sometimes quoted adds a 64-character local part to a 255-character domain and is not deliverable, so it would widen the column without accepting a usable address.

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

## Invariants in the user module

`dev.researchhub.user.domain` is the first place the "DTO validation is not the source of truth"
rule above is applied to real code. There is no user DTO yet, and the domain already enforces its
own rules:

- `UserEmail.of(String)` trims, rejects a blank address, caps it at `EMAIL_MAX`, and derives the
  lowercase normal form that uniqueness is decided on.
- `PasswordHash.ofHash(String)` rejects a blank hash. There is no constructor that accepts a
  plaintext password, so no caller can store one by mistake.
- `User` trims the display name, rejects it when blank, and caps it at `NAME_MAX`, which is also
  the `users.display_name` column length.

`RegisterRequest` reuses `EMAIL_MAX`, `NAME_MAX`, and the trim pattern for fast 400 responses, and the
domain keeps enforcing the same rules for callers that never touch a controller. One exception is
documented on that record: `password` is **not** trimmed, because a leading or trailing space is a
legitimate character in a credential and removing it would change what the user chose.

## Invariants in the workspace module

`dev.researchhub.workspace.domain` applies the same rule to the workspace tables:

- `Workspace` trims the name, rejects it when blank, and caps it at `NAME_MAX`, which is also the
  `workspaces.name` column length. It trims the description, caps it at `DESCRIPTION_MAX`, and
  normalizes a blank description to `null` so "no description" has one representation in the column
  and in the API response.
- `WorkspaceMembers` enforces a rule no DTO could express: a workspace always keeps at least one
  `OWNER`, so demoting or removing the last one fails with `CONFLICT`. It is enforced now even though
  no endpoint changes membership yet, which is the point — the endpoint cannot be written without it.

Both are checked by the database as well: `ck_workspaces_name_not_blank`, the column lengths, and
`ck_workspace_members_role`. A DTO constraint is the fast answer, the domain is the rule, and the
schema is the backstop.

## Where this is demonstrated today

The pattern above is demonstrated end-to-end by
`dev.researchhub.shared.api.ErrorHandlingTestController.NameBody`
(`backend/src/test/java`) and exercised in
`GlobalExceptionHandlerIntegrationTest`, covering:

- a blank field (`must not be blank`),
- a whitespace-only field that becomes blank after trimming,
- a field over its configured max length (`size must be between 0 and 255`),
- a field with surrounding whitespace that is trimmed before it reaches the handler.

`RegisterRequest` and `CreateWorkspaceRequest` are the real module DTOs following that pattern.
`WorkspaceApiIntegrationTest` covers it over HTTP: a whitespace-only workspace name is trimmed before
Bean Validation runs and comes back as `400 VALIDATION_FAILED` with `errors[0].field` of `name`, and no
row is written. Reuse `FieldLengths` and the trim pattern in a new DTO instead of copying literals or
writing a new normalization helper.
