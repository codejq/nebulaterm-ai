import { vi } from 'vitest';

export class Terminal {
  onData = vi.fn();
  onKey = vi.fn();
  open = vi.fn();
  write = vi.fn();
  writeln = vi.fn();
  dispose = vi.fn();
  loadAddon = vi.fn();
  focus = vi.fn();
  clear = vi.fn();
  cols = 80;
  rows = 24;
  buffer = {
    active: {
      getLine: vi.fn(() => ({ translateToString: vi.fn(() => '') })),
      cursorY: 0,
      length: 0,
    },
  };
}
