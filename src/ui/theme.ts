export type Theme = 'light' | 'dark';

const root = document.documentElement;

export function getTheme(): Theme {
  if (root.dataset.theme === 'dark' || root.classList.contains('dark-theme') || root.classList.contains('dark')) {
    return 'dark';
  }
  return 'light';
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

/** Instantly applies a theme to the live DOM and keeps class names and toggle ARIA state in sync. */
export function applyTheme(theme: Theme, toggle?: HTMLButtonElement | null): void {
  root.dataset.theme = theme;
  root.classList.remove('light-theme', 'dark-theme');
  root.classList.add(`${theme}-theme`);
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}
