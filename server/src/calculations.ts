// Re-export, not a copy. The server reuses the exact same pure functions and
// test suite the client uses (utils/calculations.ts, 47 tests) — see
// docs/MASTER_BUILD_PROMPT_v3_BACKEND.md "Shared calculations module".
export * from '../../utils/calculations';
