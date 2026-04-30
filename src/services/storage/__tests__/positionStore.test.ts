// @ts-nocheck — Jest types are not installed in this repo. SPEC defers Jest
// runner setup to a follow-up phase; the file is structurally valid and will
// type-check once `npm i -D @types/jest` is added with the runner config.

import {
  savePosition,
  loadPosition,
  resolveByMaxPercent,
  registerRestoreCheck,
  setCachedPosition,
  _resetForTests,
  type EpubLastPosition,
} from '../positionStore';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      setItem: jest.fn(async (k: string, v: string) => {
        store[k] = v;
      }),
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      removeItem: jest.fn(async (k: string) => {
        delete store[k];
      }),
      _reset: () => {
        store = {};
      },
    },
  };
});

jest.mock('@/services/sync/syncEngine', () => ({
  pushPosition: jest.fn(async () => {}),
}));

const AsyncStorage = require('@react-native-async-storage/async-storage').default;

const mkPos = (overrides: Partial<EpubLastPosition> = {}): EpubLastPosition => ({
  cfi: 'epubcfi(/6/4!/4/1:0)',
  chapterIndex: 1,
  charOffset: 0,
  percentComplete: 0.1,
  updatedAt: Date.now(),
  ...overrides,
});

beforeEach(() => {
  _resetForTests();
  AsyncStorage._reset();
  AsyncStorage.setItem.mockClear();
  AsyncStorage.getItem.mockClear();
});

describe('resolveByMaxPercent', () => {
  it('local 12% vs remote 47% → remote wins (SPEC AC-6)', () => {
    const local = mkPos({ percentComplete: 0.12 });
    const remote = mkPos({ percentComplete: 0.47 });
    expect(resolveByMaxPercent(local, remote)).toBe('remote');
  });

  it('local 50% vs remote 5% (stub) → local wins (SPEC AC-6)', () => {
    const local = mkPos({ percentComplete: 0.5 });
    const remote = mkPos({ percentComplete: 0.05 });
    expect(resolveByMaxPercent(local, remote)).toBe('local');
  });

  it('tiebreaker on equal percent → local wins', () => {
    const local = mkPos({ percentComplete: 0.3 });
    const remote = mkPos({ percentComplete: 0.3 });
    expect(resolveByMaxPercent(local, remote)).toBe('local');
  });

  it('remote percent zero → local wins', () => {
    const local = mkPos({ percentComplete: 0.1 });
    const remote = mkPos({ percentComplete: 0 });
    expect(resolveByMaxPercent(local, remote)).toBe('local');
  });

  it('local percent zero, remote populated → remote wins', () => {
    const local = mkPos({ percentComplete: 0 });
    const remote = mkPos({ percentComplete: 0.4 });
    expect(resolveByMaxPercent(local, remote)).toBe('remote');
  });
});

describe('savePosition / loadPosition', () => {
  it('saved position survives a load round-trip', async () => {
    const pos = mkPos({ chapterIndex: 5, percentComplete: 0.3 });
    savePosition('book-A', pos, {
      userId: null,
      deviceId: null,
      trigger: 'test',
    });
    await new Promise((r) => setTimeout(r, 0));
    const loaded = await loadPosition('book-A');
    expect(loaded).toEqual(pos);
  });

  it('save no-ops while restore is in progress', async () => {
    let inRestore = true;
    registerRestoreCheck('book-A', () => inRestore);
    const pos = mkPos({ chapterIndex: 0, cfi: 'epubcfi(/6/2!/4/1:0)' });
    savePosition('book-A', pos, {
      userId: null,
      deviceId: null,
      trigger: 'background',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    inRestore = false;
    const real = mkPos({ chapterIndex: 5, cfi: 'epubcfi(/6/12!/4/1:0)' });
    savePosition('book-A', real, {
      userId: null,
      deviceId: null,
      trigger: 'chapter-change',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('save skips when cfi is empty', async () => {
    const pos = mkPos({ cfi: '' });
    savePosition('book-A', pos, {
      userId: null,
      deviceId: null,
      trigger: 'test',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('loadPosition returns null when no value stored', async () => {
    expect(await loadPosition('book-empty')).toBeNull();
  });

  it('in-memory cache shortcuts AsyncStorage on second load', async () => {
    const pos = mkPos();
    setCachedPosition('book-A', pos);
    AsyncStorage.getItem.mockClear();
    const loaded = await loadPosition('book-A');
    expect(loaded).toEqual(pos);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});
