// Backward-compatible entry point. The neutral design contract now owns both
// web and mobile outputs; package scripts call it directly.
await import('../../scripts/generate-design.mjs');
