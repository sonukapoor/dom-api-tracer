// Registers the same two tests in each test file (a.test.mjs, b.test.mjs):
// whichever runs second in the shared worker sees what the first left.
import { test, expect, vi } from 'vitest';

export function register() {
  const shared = (globalThis.__cleanupFixture ??= { files: 0, url: location.href, api: { value: () => 'real' } });

  test('starts clean', () => {
    expect(document.body.childNodes.length).toBe(0);
    expect(document.body.hasAttribute('class')).toBe(false);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.title).toBe('');
    expect(document.cookie).toBe('');
    expect(location.href).toBe(shared.url);
    expect(vi.isFakeTimers()).toBe(false);
    expect(shared.api.value()).toBe('real');
    expect(globalThis.stubbedGlobal).toBe(undefined);
    expect(process.env.FIXTURE_STUBBED).toBe(undefined);
    // Testing Library's cleanup (a stand-in package) ran once per earlier file.
    expect(globalThis.__testingLibraryCleanups ?? 0).toBe(shared.files);
    // Head nodes are kept (libraries insert their styles once).
    expect(document.head.querySelectorAll('style[data-fixture]').length).toBe(shared.files > 0 ? 1 : 0);
  });

  test('leaves state behind', () => {
    // From the second file on, Testing Library's cleanup also runs after
    // each test (registered again per file): once more after 'starts clean'.
    expect(globalThis.__testingLibraryCleanups ?? 0).toBe(shared.files === 0 ? 0 : 2);
    shared.files++;
    document.body.append(document.createElement('div'));
    document.body.className = 'modal-open';
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('k', 'v');
    sessionStorage.setItem('k', 'v');
    document.title = 'changed';
    document.cookie = 'top=1';
    history.pushState(null, '', '/deep/page');
    document.cookie = 'deep=1; path=/deep';
    vi.useFakeTimers();
    vi.spyOn(shared.api, 'value').mockReturnValue('mocked');
    vi.stubGlobal('stubbedGlobal', 1);
    vi.stubEnv('FIXTURE_STUBBED', '1');
    if (!document.head.querySelector('style[data-fixture]')) {
      const style = document.createElement('style');
      style.setAttribute('data-fixture', '');
      document.head.append(style);
    }
  });
}
