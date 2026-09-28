import { test, expect, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.locator('[data-nav-id="nav-home"]')).toBeVisible()
}
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:5174/api/test/reset') })

test('root Back delegates exit to webOS and already-consumed Back does not navigate', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { exitCalls: 0, webOSSystem: { platformBack() { (window as any).exitCalls++ } } })
  })
  await page.goto('/')
  await page.locator('[data-nav-id="nav-home"]').focus()
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => (window as any).exitCalls)).toBe(1)
  await page.locator('[data-nav-id="nav-search"]').click()
  await page.evaluate(() => document.addEventListener('keydown', event => {
    if (event.key === 'Escape') event.preventDefault()
  }, { capture: true, once: true }))
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-nav-id="nav-search"]')).toHaveClass(/active/)
  await expect.poll(() => page.evaluate(() => (window as any).exitCalls)).toBe(1)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
test(`horizontal card navigation respects ${reducedMotion} without jumping the page`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion })
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'catalog') return route.continue()
    await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: false, items: Array.from({ length: 20 }, (_, i) => ({ id: String(200 + i), title: `Тест ${i}`, url: `https://hdrezka-home.tv/films/fiction/${200 + i}-test.html`, type: 'movie' })) } } })
  })
  await login(page)
  const first = page.locator('[data-nav-id="new-200"]')
  await first.scrollIntoViewIfNeeded(); await first.focus()
  const before = await page.locator('.content-area').evaluate(el => el.scrollTop)
  await page.evaluate(() => {
    (window as any).rowScrollCalls = []
    const original = Element.prototype.scrollTo
    Element.prototype.scrollTo = function (...args: any[]) {
      if (this.classList.contains('poster-row')) (window as any).rowScrollCalls.push(args[0])
      return (original as any).apply(this, args)
    }
  })
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-nav-id="new-208"]')).toBeFocused()
  const behavior = reducedMotion === 'reduce' ? 'instant' : 'smooth'
  await expect.poll(() => page.evaluate(behavior => (window as any).rowScrollCalls.some((value: any) => value?.behavior === behavior), behavior)).toBe(true)
  await expect.poll(() => page.locator('.content-area').evaluate(el => el.scrollTop)).toBeCloseTo(before, 0)
  await expect.poll(() => page.locator('[data-nav-id="new-208"]').evaluate(el => {
    const rect = el.getBoundingClientRect(), row = el.closest('.poster-row')!.getBoundingClientRect()
    return rect.left >= row.left && rect.right <= row.right
  })).toBe(true)
})
}

test('adjacent poster navigation measures only nearby cards before mutating focus', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'catalog') return route.continue()
    await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: false, items: Array.from({ length: 20 }, (_, i) => ({ id: String(200 + i), title: `Тест ${i}`, url: `https://hdrezka-home.tv/films/fiction/${200 + i}-test.html`, type: 'movie' })) } } })
  })
  await login(page)
  await page.locator('[data-nav-id="new-200"]').scrollIntoViewIfNeeded()
  await page.locator('[data-nav-id="new-200"]').focus()
  const measurements = await page.evaluate(() => {
    const bounds = Element.prototype.getBoundingClientRect
    const rects = Element.prototype.getClientRects
    const focus = HTMLElement.prototype.focus
    let cardReads = 0, readsAfterFocus = 0, focused = false
    const measure = (element: Element) => { if (element.matches('.poster-card')) cardReads++; if (focused) readsAfterFocus++ }
    Element.prototype.getBoundingClientRect = function () { measure(this); return bounds.call(this) }
    Element.prototype.getClientRects = function () { measure(this); return rects.call(this) }
    HTMLElement.prototype.focus = function (options) { focused = true; focus.call(this, options) }
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      return { cardReads, readsAfterFocus }
    } finally {
      Element.prototype.getBoundingClientRect = bounds
      Element.prototype.getClientRects = rects
      HTMLElement.prototype.focus = focus
    }
  })
  await expect(page.locator('[data-nav-id="new-201"]')).toBeFocused()
  expect(measurements.cardReads).toBeLessThanOrEqual(4)
  expect(measurements.readsAfterFocus).toBe(0)
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('[data-nav-id="new-200"]')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('[data-nav-id="bookmarks-100"]')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.sidebar button:focus')).toHaveCount(1)
})

test('vertical Home navigation reveals the destination shelf heading and wheel scrolls both ways', async ({ page }) => {
  await login(page)
  await expect(page.locator('[data-nav-id="popular-100"]')).toBeVisible()
  const content = page.locator('.content-area')
  await content.evaluate(element => { element.scrollTop = 500 })
  await page.locator('[data-nav-id="continue-100"]').focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('[data-nav-id="nav-home"]')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-nav-id="continue-100"]')).toBeFocused()
  await expect.poll(() => page.locator('.shelf').first().locator('.section-heading').evaluate(heading => heading.getBoundingClientRect().top >= heading.closest('.content-area')!.getBoundingClientRect().top)).toBe(true)
  await content.evaluate(element => { element.scrollTop = 500 })
  await page.locator('[data-nav-id="bookmarks-100"]').focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('[data-nav-id="continue-100"]')).toBeFocused()
  await expect.poll(() => page.locator('[data-nav-id="continue-100"]').evaluate(element => {
    const shelf = element.closest('.shelf')!, heading = shelf.querySelector('.section-heading')!, viewport = element.closest('.content-area')!
    return heading.getBoundingClientRect().top >= viewport.getBoundingClientRect().top
  })).toBe(true)
  const row = page.locator('.poster-row').first()
  await content.evaluate(element => { element.scrollTop = 0 })
  await row.hover(); await page.mouse.wheel(0, 600)
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const down = await content.evaluate(element => element.scrollTop)
  const horizontal = await row.evaluate(element => element.scrollLeft)
  await page.mouse.wheel(0, -600)
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeLessThan(down)
  await expect.poll(() => page.locator('.shelf').first().locator('.section-heading').evaluate(heading => heading.getBoundingClientRect().top >= heading.closest('.content-area')!.getBoundingClientRect().top)).toBe(true)
  expect(await row.evaluate(element => element.scrollLeft)).toBe(horizontal)
})

test('Bookmarks stays at the top after delayed data and Up can reveal its title again', async ({ page }) => {
  let listCalls = 0, release!: () => void, markStarted!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    if (method === 'bookmarkLists' && ++listCalls === 2) { markStarted(); await gate }
    if (method === 'bookmarks') {
      await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: false, items: Array.from({ length: 60 }, (_, index) => ({ id: String(1000 + index), title: `Закладка ${index + 1}`, url: `https://hdrezka-home.tv/films/fiction/${1000 + index}-test.html`, type: 'movie' })) } } })
    } else await route.fallback()
  })
  await login(page)
  const content = page.locator('.content-area')
  const title = page.getByRole('heading', { name: 'Мои закладки', exact: true })
  await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(60)
  const deepCard = page.locator('[data-nav-id="bookmarks-1025"]')
  await deepCard.scrollIntoViewIfNeeded(); await deepCard.focus()
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.locator('[data-nav-id="nav-films"]').click()
  await page.locator('[data-nav-id="nav-bookmarks"]').click(); await started
  await expect(content).toHaveJSProperty('scrollTop', 0)
  await expect(title).toBeInViewport()
  release()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(60)
  await expect(content).toHaveJSProperty('scrollTop', 0)
  await expect(title).toBeInViewport()

  const fourthRow = page.locator('[data-nav-id="bookmarks-1015"]')
  await fourthRow.scrollIntoViewIfNeeded(); await fourthRow.focus()
  for (let index = 0; index < 5; index++) await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('combobox', { name: 'Список аккаунта', exact: true })).toBeFocused()
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0)
  await expect(title).toBeInViewport()
})

test('Back restores a cached Bookmark position before its list request finishes', async ({ page }) => {
  let listCalls = 0, release!: () => void, markStarted!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    if (method === 'bookmarkLists' && ++listCalls === 2) { markStarted(); await gate }
    if (method === 'bookmarks') {
      await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: false, items: Array.from({ length: 40 }, (_, index) => ({ id: String(1000 + index), title: `Закладка ${index + 1}`, url: `https://hdrezka-home.tv/films/fiction/${1000 + index}-test.html`, type: 'movie' })) } } })
    } else await route.fallback()
  })
  await login(page); await page.locator('[data-nav-id="nav-bookmarks"]').click()
  const content = page.locator('.content-area')
  const card = page.locator('[data-nav-id="bookmarks-1025"]')
  await card.scrollIntoViewIfNeeded(); await card.focus()
  const savedScroll = await content.evaluate(element => element.scrollTop)
  await card.click(); await expect(page.locator('[data-nav-id="detail-play"]')).toBeVisible()
  await page.keyboard.press('Escape'); await started
  await expect(card).toBeFocused()
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeCloseTo(savedScroll, 0)
  await page.keyboard.press('ArrowUp')
  const moved = await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.navId)
  release(); await expect(page.locator('.poster-grid .poster-card')).toHaveCount(40)
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.navId)).toBe(moved)
})

test('Home vertical navigation skips a loading shelf', async ({ page }) => {
  let release!: () => void, markStarted!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method === 'bookmarks') { markStarted(); await gate }
    await route.fallback()
  })
  await login(page); await started
  await expect(page.locator('[data-nav-id="new-100"]')).toBeVisible()
  await page.locator('[data-nav-id="continue-100"]').focus(); await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-nav-id="new-100"]')).toBeFocused()
  release()
})

test('Details can navigate from episode 16 back to the complete hero', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'details') { await route.fallback(); return }
    const response = await route.fetch(), json = await response.json()
    json.result.episodes = Array.from({ length: 30 }, (_, index) => ({ season: 1, episode: index + 1, title: `Серия ${index + 1}` }))
    await route.fulfill({ json })
  })
  await login(page)
  await page.locator('[data-nav-id="new-100"]').click()
  const content = page.locator('.content-area')
  const episode = page.locator('[data-nav-id="episode-1-16"]')
  await episode.scrollIntoViewIfNeeded(); await episode.focus()
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  for (let index = 0; index < 6; index++) await page.keyboard.press('ArrowUp')
  await expect(page.locator('.detail-actions button:focus')).toHaveCount(1)
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0)
  await expect(page.locator('.detail-artwork')).toBeInViewport()
  await expect(page.locator('.detail-title h1')).toBeInViewport()
})

test('held Home arrows use bounded acceleration and keep focus visible', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'catalog') { await route.fallback(); return }
    await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: false, items: Array.from({ length: 20 }, (_, index) => ({ id: String(200 + index), title: `Тест ${index}`, url: `https://hdrezka-home.tv/films/fiction/${200 + index}-test.html`, type: 'movie' })) } } })
  })
  await login(page)
  await page.evaluate(() => {
    let now = 0
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
    Object.assign(window, { navKey(key: string, time: number, type = 'keydown') { now = time; document.dispatchEvent(new KeyboardEvent(type, { key, keyCode: ({ ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 } as any)[key], repeat: false, bubbles: true, cancelable: true })) } })
  })
  await page.locator('[data-nav-id="continue-100"]').focus()
  await page.evaluate(() => { for (const time of [0, 30, 60, 90]) (window as any).navKey('ArrowDown', time) })
  await expect(page.locator('[data-nav-id="new-200"]')).toBeFocused()
  await expect.poll(() => page.locator('[data-nav-id="new-200"]').evaluate(element => { const rect = element.getBoundingClientRect(), root = element.closest('.content-area')!.getBoundingClientRect(); return rect.top >= root.top && rect.bottom <= root.bottom })).toBe(true)
  await page.evaluate(() => (window as any).navKey('ArrowDown', 100, 'keyup'))
  await page.locator('[data-nav-id="new-205"]').scrollIntoViewIfNeeded(); await page.locator('[data-nav-id="new-205"]').focus()
  await page.evaluate(() => { for (const time of [200, 230, 260, 290]) (window as any).navKey('ArrowLeft', time) })
  await expect(page.locator('[data-nav-id="new-203"]')).toBeFocused()
  await expect.poll(() => page.locator('[data-nav-id="new-203"]').evaluate(element => { const rect = element.getBoundingClientRect(), row = element.closest('.poster-row')!.getBoundingClientRect(); return rect.left >= row.left && rect.right <= row.right })).toBe(true)
})

test('Up from Continue opens the navbar and Right restores the same card', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'continueWatching') { await route.fallback(); return }
    await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: false, items: Array.from({ length: 12 }, (_, index) => ({ id: String(500 + index), title: `Продолжить ${index + 1}`, url: `https://hdrezka-home.tv/films/fiction/${500 + index}-test.html`, type: 'movie', progress: { id: String(500 + index), url: `https://hdrezka-home.tv/films/fiction/${500 + index}-test.html`, translatorId: '1', position: null, duration: null, completed: false } })) } } })
  })
  await login(page)
  const card = page.locator('[data-nav-id="continue-508"]')
  await card.scrollIntoViewIfNeeded(); await card.focus()
  const row = card.locator('xpath=..')
  const horizontal = await row.evaluate(element => element.scrollLeft)
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('[data-nav-id="nav-home"]')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(card).toBeFocused()
  expect(await row.evaluate(element => element.scrollLeft)).toBe(horizontal)
})

test('large grids navigate by columns without scanning every card or queuing smooth scrolls', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'catalog' || params.category !== 'films') { await route.fallback(); return }
    await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: false, items: Array.from({ length: 200 }, (_, index) => ({ id: String(1000 + index), title: `Фильм ${index + 1}`, url: `https://hdrezka-home.tv/films/fiction/${1000 + index}-test.html`, type: 'movie' })) } } })
  })
  await login(page); await page.locator('[data-nav-id="nav-films"]').click()
  const start = page.locator('[data-nav-id="catalog-1050"]')
  await start.scrollIntoViewIfNeeded(); await start.focus()
  await page.evaluate(() => {
    let now = 0, posterReads = 0
    const bounds = Element.prototype.getBoundingClientRect, scrollTo = Element.prototype.scrollTo
    Element.prototype.getBoundingClientRect = function () { if (this.matches('.poster-card')) posterReads++; return bounds.call(this) }
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
    Object.assign(window, {
      navStats: { behaviors: [] as string[], get posterReads() { return posterReads } },
      navDown(time: number, type = 'keydown') { now = time; document.dispatchEvent(new KeyboardEvent(type, { key: 'ArrowDown', keyCode: 40, repeat: false, bubbles: true, cancelable: true })) }
    })
    Element.prototype.scrollTo = function (...args: any[]) { if (this.classList.contains('content-area')) (window as any).navStats.behaviors.push(args[0]?.behavior); return (scrollTo as any).apply(this, args) }
  })
  await page.evaluate(() => { for (const time of [0, 30, 60, 90, 120, 150, 180]) (window as any).navDown(time) })
  await expect(page.locator('[data-nav-id="catalog-1065"]')).toBeFocused()
  const stats = await page.evaluate(() => (window as any).navStats)
  expect(stats.posterReads).toBeLessThanOrEqual(12)
  expect(stats.behaviors).toContain('smooth')
  expect(stats.behaviors).toContain('auto')
  await expect.poll(() => page.locator('[data-nav-id="catalog-1065"]').evaluate(element => { const rect = element.getBoundingClientRect(), root = element.closest('.content-area')!.getBoundingClientRect(); return rect.top >= root.top && rect.bottom <= root.bottom })).toBe(true)
  await page.evaluate(() => { (window as any).navDown(181, 'keyup'); (window as any).navDown(182) })
  await expect(page.locator('[data-nav-id="catalog-1070"]')).toBeFocused()
})

test('sidebar arrows avoid poster measurements and include Profile and the save retry', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'catalog') return route.continue()
    await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: false, items: Array.from({ length: 20 }, (_, i) => ({ id: String(200 + i), title: `Тест ${i}`, url: `https://hdrezka-home.tv/films/fiction/${200 + i}-test.html`, type: 'movie' })) } } })
  })
  await login(page)
  await expect(page.locator('.poster-row').filter({ has: page.locator('[data-nav-id="new-200"]') }).locator('.poster-card')).toHaveCount(20)
  await page.locator('[data-nav-id="nav-home"]').focus()
  const posterReads = await page.evaluate(() => {
    const bounds = Element.prototype.getBoundingClientRect, rects = Element.prototype.getClientRects
    let reads = 0
    Element.prototype.getBoundingClientRect = function () { if (this.matches('.poster-card')) reads++; return bounds.call(this) }
    Element.prototype.getClientRects = function () { if (this.matches('.poster-card')) reads++; return rects.call(this) }
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }))
      return reads
    } finally {
      Element.prototype.getBoundingClientRect = bounds
      Element.prototype.getClientRects = rects
    }
  })
  await expect(page.locator('[data-nav-id="nav-search"]')).toBeFocused()
  expect(posterReads).toBe(0)
  await page.evaluate(() => {
    const retry = document.createElement('button')
    retry.className = 'save-retry-icon'
    retry.dataset.navId = 'nav-test-retry'
    retry.textContent = 'Повторить'
    document.querySelector('.sidebar-account')!.appendChild(retry)
  })
  await page.locator('[data-nav-id="nav-animation"]').focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-nav-id="nav-profile"]')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-nav-id="nav-test-retry"]')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('[data-nav-id="nav-profile"]')).toBeFocused()
  await page.locator('[data-nav-id="nav-test-retry"]').evaluate(button => { (button as HTMLButtonElement).disabled = true })
  await page.locator('[data-nav-id="nav-animation"]').focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-nav-id="nav-profile"]')).toBeFocused()
})
