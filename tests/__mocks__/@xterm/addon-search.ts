import { vi } from 'vitest';
export class SearchAddon {
  activate = vi.fn();
  dispose = vi.fn();
  findNext = vi.fn();
  findPrevious = vi.fn();
}
