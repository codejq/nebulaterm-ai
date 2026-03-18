import { vi } from 'vitest';
export const listen = vi.fn(() => Promise.resolve(vi.fn()));
