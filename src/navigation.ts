const focusSelector = 'button:not(:disabled), a[href], summary, input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

export function focusFirst(scope: ParentNode = document) {
  const target = scope.querySelector<HTMLElement>('[data-autofocus]') || scope.querySelector<HTMLElement>(focusSelector);
  target?.focus({ preventScroll: true });
}

export function platformBack() {
  const host = window as typeof window & { webOSSystem?: { platformBack(): void }; PalmSystem?: { platformBack(): void } };
  const system = host.webOSSystem || host.PalmSystem;
  if (typeof system?.platformBack !== 'function') return false;
  system.platformBack();
  return true;
}

type RevealBehavior = 'auto' | 'smooth' | 'instant';
const focusGroupSelector = '.poster-row,.poster-grid,.episode-grid,.tv-select-options';
const lastFocused = new WeakMap<HTMLElement, HTMLElement>();

function remember(target: HTMLElement) {
  const group = target.closest<HTMLElement>(focusGroupSelector);
  if (group) lastFocused.set(group, target);
}

function focusAndReveal(target: HTMLElement, horizontal: boolean, behavior: RevealBehavior) {
  const scrolls: [HTMLElement, ScrollToOptions][] = [];
  const rect = target.getBoundingClientRect();
  const row = target.closest<HTMLElement>('.poster-row');
  if (row) {
    const bounds = row.getBoundingClientRect();
    const delta = rect.left < bounds.left + 12 ? rect.left - bounds.left - 12 : rect.right > bounds.right - 12 ? rect.right - bounds.right + 12 : 0;
    if (delta) scrolls.push([row, { left: row.scrollLeft + delta, behavior: behavior as ScrollBehavior }]);
  }
  if (!row || !horizontal) {
    const verticalRect = !horizontal && row ? (target.closest<HTMLElement>('.shelf')?.getBoundingClientRect() || rect) : rect;
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent.scrollHeight <= parent.clientHeight || !/auto|scroll/.test(getComputedStyle(parent).overflowY)) continue;
      const bounds = parent.getBoundingClientRect();
      const delta = verticalRect.top < bounds.top + 12 ? verticalRect.top - bounds.top - 12 : verticalRect.bottom > bounds.bottom - 12 ? verticalRect.bottom - bounds.bottom + 12 : 0;
      if (delta) scrolls.push([parent, { top: parent.scrollTop + delta, behavior: behavior as ScrollBehavior }]);
      break;
    }
  }
  target.focus({ preventScroll: true });
  remember(target);
  for (const [element, options] of scrolls) element.scrollTo(options);
}

function gridTarget(active: HTMLElement, key: string) {
  const grid = active.parentElement?.matches('.poster-grid,.episode-grid') ? active.parentElement : null;
  if (!grid) return;
  const items = [...grid.children].filter((item): item is HTMLElement => item instanceof HTMLElement && item.matches(focusSelector) && !(item as HTMLButtonElement).disabled);
  const index = items.indexOf(active);
  const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length);
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const targetIndex = index + (key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -columns : columns);
  if (targetIndex < 0 || targetIndex >= items.length || horizontal && Math.floor(index / columns) !== Math.floor(targetIndex / columns)) return;
  return items[targetIndex];
}

function linearTarget(active: HTMLElement, key: string) {
  const list = active.parentElement?.matches('.tv-select-options') ? active.parentElement : null;
  if (!list || !['ArrowUp', 'ArrowDown'].includes(key)) return;
  const items = [...list.children].filter((item): item is HTMLElement => item instanceof HTMLElement && item.matches(focusSelector) && !(item as HTMLButtonElement).disabled);
  const target = items[items.indexOf(active) + (key === 'ArrowUp' ? -1 : 1)];
  return target ? { target } : undefined;
}

function shelfTarget(active: HTMLElement, key: string, scope: ParentNode) {
  const row = active.closest<HTMLElement>('.poster-row');
  const shelf = active.closest<HTMLElement>('.shelf');
  if (!row || !shelf || !['ArrowUp', 'ArrowDown'].includes(key)) return;
  const shelfControl = key === 'ArrowUp' ? shelf.querySelector<HTMLElement>('.section-heading button:not(:disabled),.empty-state button:not(:disabled)') : undefined;
  if (shelfControl) return { target: shelfControl, boundary: false as const };
  const shelves = [...scope.querySelectorAll<HTMLElement>('.shelf')].filter(item => item.querySelector('.poster-row > .poster-card:not(:disabled),.franchise-list > .franchise-row:not(:disabled),.franchise-toggle:not(:disabled),.empty-state button:not(:disabled)'));
  const targetIndex = shelves.indexOf(shelf) + (key === 'ArrowUp' ? -1 : 1);
  const targetShelf = shelves[targetIndex];
  if (!targetShelf) return { boundary: true as const };
  const franchiseList = targetShelf.querySelector<HTMLElement>('.franchise-list');
  if (key === 'ArrowUp' && franchiseList) {
    const rows = [...franchiseList.querySelectorAll<HTMLElement>('.franchise-row:not(:disabled)')];
    return { target: targetShelf.querySelector<HTMLElement>('.franchise-toggle:not(:disabled)') || rows.at(-1), boundary: false as const, start: false };
  }
  const firstCard = targetShelf.querySelector<HTMLElement>('.poster-row > .poster-card:not(:disabled)');
  if (!firstCard) return { target: targetShelf.querySelector<HTMLElement>('.empty-state button:not(:disabled)') || undefined, boundary: false as const, start: targetIndex === 0 };
  const targetRow = firstCard.closest<HTMLElement>('.poster-row')!;
  const remembered = lastFocused.get(targetRow);
  if (remembered?.isConnected && !(remembered as HTMLButtonElement).disabled) return { target: remembered, boundary: false as const, start: targetIndex === 0 };
  const current = [...row.children].indexOf(active);
  const items = [...targetRow.children].filter((item): item is HTMLElement => item instanceof HTMLElement && item.matches(focusSelector) && !(item as HTMLButtonElement).disabled);
  return { target: items[Math.min(Math.max(0, current), items.length - 1)], boundary: false as const, start: targetIndex === 0 };
}

function revealStart(active: HTMLElement, behavior: RevealBehavior) {
  const root = active.closest<HTMLElement>('.content-area');
  if (!root || root.scrollTop <= 0) return false;
  root.scrollTo({ top: 0, behavior: behavior as ScrollBehavior });
  return true;
}

export function installNavigation(back: () => void) {
  const frequency = [3, 3, 3, 2, 2, 2, 1];
  let repeatKey = '', repeatStarted = 0, repeatSeenAt = 0, repeatSkipped = 0, lastAcceptedAt = -Infinity;
  let backDown = false;
  const resetRepeat = () => { repeatKey = ''; repeatStarted = 0; repeatSeenAt = 0; repeatSkipped = 0; lastAcceptedAt = -Infinity; };
  const resetInput = () => { backDown = false; resetRepeat(); };
  const isBack = (event: KeyboardEvent) => event.key === 'Escape' || event.keyCode === 461 || event.key === 'Backspace';
  const arrowKey = (event: KeyboardEvent) => event.key.startsWith('Arrow') ? event.key : ({ 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' } as Record<number, string>)[event.keyCode] || '';
  const admit = (key: string) => {
    const now = performance.now();
    if (key !== repeatKey || now - repeatSeenAt > 700) {
      repeatKey = key; repeatStarted = repeatSeenAt = lastAcceptedAt = now; repeatSkipped = 0;
      return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    }
    repeatSeenAt = now;
    const seconds = Math.min(frequency.length - 1, Math.floor((now - repeatStarted) / 1000));
    const toSkip = frequency[seconds]! - 1;
    if (repeatSkipped < toSkip) { repeatSkipped++; return; }
    repeatSkipped = 0;
    if (now - lastAcceptedAt < 90) return;
    lastAcceptedAt = now;
    return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'auto';
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const active = document.activeElement as HTMLElement | null;
    const editing = active instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(active.type) || active instanceof HTMLTextAreaElement;
    if (event.key === 'Escape' || event.keyCode === 461 || (event.key === 'Backspace' && !editing)) {
      event.preventDefault();
      if (backDown) return;
      backDown = true;
      back();
      return;
    }
    const key = arrowKey(event);
    if (!key) return;
    if (editing && (active instanceof HTMLTextAreaElement || ['ArrowLeft', 'ArrowRight'].includes(key))) return;
    if (active instanceof HTMLSelectElement && ['ArrowUp', 'ArrowDown'].includes(key)) return;
    if (active instanceof HTMLInputElement && active.type === 'range' && ['ArrowLeft', 'ArrowRight'].includes(key)) return;
    const behavior = admit(key);
    if (!behavior) { event.preventDefault(); return; }
    const scopes = document.querySelectorAll<HTMLElement>('[data-focus-scope]');
    const scope = scopes[scopes.length - 1] || document;
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const sidebar = !horizontal && active?.closest<HTMLElement>('.sidebar');
    if (sidebar && active && scope.contains(active) && !active.closest('[inert]')) {
      const buttons = [...sidebar.querySelectorAll<HTMLElement>('button:not(:disabled)')].filter(button => scope.contains(button) && !button.closest('[inert]') && button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden');
      const index = buttons.indexOf(active);
      if (index >= 0) {
        event.preventDefault();
        const next = buttons[index + (key === 'ArrowUp' ? -1 : 1)];
        if (next) focusAndReveal(next, false, behavior);
        return;
      }
    }
    if (horizontal && active?.matches('.poster-row > .poster-card') && scope.contains(active) && !active.closest('[inert]')) {
      const forward = key === 'ArrowRight';
      for (let sibling = forward ? active.nextElementSibling : active.previousElementSibling; sibling; sibling = forward ? sibling.nextElementSibling : sibling.previousElementSibling) {
        if (!(sibling instanceof HTMLElement) || !sibling.matches(focusSelector) || !sibling.getClientRects().length || sibling.closest('[inert]') || getComputedStyle(sibling).visibility === 'hidden') continue;
        event.preventDefault();
        focusAndReveal(sibling, true, behavior);
        return;
      }
    }
    if (active && scope.contains(active) && !active.closest('[inert]')) {
      remember(active);
      const shelf = shelfTarget(active, key, scope);
      if (shelf) {
        event.preventDefault();
        if (shelf.target) { focusAndReveal(shelf.target, false, behavior); if (shelf.start && key === 'ArrowUp') revealStart(shelf.target, behavior); }
        else if (key === 'ArrowUp') {
          const activeNav = document.querySelector<HTMLElement>('.sidebar button.active:not(:disabled)');
          revealStart(active, behavior);
          if (activeNav) focusAndReveal(activeNav, false, behavior); else focusAndReveal(active, false, behavior);
        }
        return;
      }
      const linear = linearTarget(active, key);
      if (linear) { event.preventDefault(); if (linear.target) focusAndReveal(linear.target, false, behavior); return; }
      const direct = gridTarget(active, key);
      if (direct) { event.preventDefault(); focusAndReveal(direct, horizontal, behavior); return; }
    }
    const verticalSurface = !horizontal ? active?.closest<HTMLElement>('.content-area,.sidebar') : null;
    const candidates = [...scope.querySelectorAll<HTMLElement>(focusSelector)].filter(item => (!verticalSurface || verticalSurface.contains(item)) && item.getClientRects().length && !item.closest('[inert]') && getComputedStyle(item).visibility !== 'hidden');
    if (!active || !candidates.includes(active)) { event.preventDefault(); focusFirst(scope); return; }
    const origin = active.getBoundingClientRect();
    const x = origin.left + origin.width / 2;
    const y = origin.top + origin.height / 2;
    const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    let best: HTMLElement | undefined;
    let bestScore = Infinity;
    for (const item of candidates) {
      if (item === active) continue;
      const rect = item.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - x;
      const dy = rect.top + rect.height / 2 - y;
      const along = (horizontal ? dx : dy) * sign;
      if (along <= 1) continue;
      const across = Math.abs(horizontal ? dy : dx);
      const overlaps = horizontal ? rect.bottom > origin.top && rect.top < origin.bottom : rect.right > origin.left && rect.left < origin.right;
      const score = along + across * 2 + (overlaps ? 0 : 2000);
      if (score < bestScore) { best = item; bestScore = score; }
    }
    event.preventDefault();
    if (best) {
      const group = best.closest<HTMLElement>(focusGroupSelector);
      const saved = group && active.closest(focusGroupSelector) !== group ? lastFocused.get(group) : undefined;
      focusAndReveal(saved?.isConnected && !(saved as HTMLButtonElement).disabled ? saved : best, horizontal, behavior);
    } else if (key === 'ArrowUp') revealStart(active, behavior);
  };
  const keyup = (event: KeyboardEvent) => { if (isBack(event)) backDown = false; if (arrowKey(event) === repeatKey) resetRepeat(); };
  const pointer = (event: PointerEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(focusSelector);
    resetRepeat();
    if (target && !target.closest('[inert]')) { target.focus({ preventScroll: true }); remember(target); }
  };
  const visibility = () => { if (document.hidden) resetInput(); };
  document.addEventListener('keydown', keydown);
  document.addEventListener('keyup', keyup);
  document.addEventListener('pointerdown', pointer);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', resetInput);
  window.addEventListener('pagehide', resetInput);
  return () => {
    document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); document.removeEventListener('pointerdown', pointer); document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('blur', resetInput); window.removeEventListener('pagehide', resetInput);
  };
}
