// Re-export shim: short-code generation moved to domain/codes.ts (it's pure
// domain logic). This keeps every existing importer — routes, counter-adjacent
// code, and codes.test.ts (`import('./codes.js')`) — working unchanged.
export * from './domain/codes';
