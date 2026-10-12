# Saved SOLUTION v3

`solution.schema.json` is a server assembled, persisted result after the two controlled PROBLEM phases. The existing bounded v2 TABLE/CHART/TEXT sandbox transport and v1/v2 readers remain unchanged. The Java host validates the native candidate and receipt, hashes the trusted runtime files inside each fresh pinned container, requires identical compute/verify code hashes, then assembles this bundle. Neither generated code nor LLM prose can grant CHECKED.

Every checked step binds a deterministic step UUID, output name, exact plan AST, explicit input substitutions (including SI conversions), saved numeric values and unit. It has at most four steps per output, eight outputs, 32 steps and 256 KiB total. The runtime verifier independently recomputes the candidate, substitutions, units and equivalence; the Java host does no CAS. Receipt version/tolerance, input/plan/candidate hashes, exact image/runtime and both code hashes persist. Reading the bundle never invokes the planner or sandbox.

The interpretation object is always NOT_CHECKED. Its summary, assumptions and warnings are explanatory text, not verified physics or proof. Old successful runs without a bundle remain readable through their native record; explicit reproduce creates a new execution with a bundle. `solution.json` is a contract example, not an execution receipt from a live workspace.
