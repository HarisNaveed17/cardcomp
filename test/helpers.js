import { readFileSync } from 'node:fs';

export const fixture = name =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

// Fixtures were captured in October 2026.
export const NOW = Date.parse('2026-10-09T12:00:00');
