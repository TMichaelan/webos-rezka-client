import { test, expect, type Page } from '@playwright/test'

const backend = 'http://127.0.0.1:5174'
const item = (id: number) => ({ id: String(id), title: `Лента ${id}`, url: `https://hdrezka-home.tv/films/fiction/${id}-test.html`, type: 'movie' })
async function login(page: Page) {
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
}
test.beforeEach(async ({ request }) => { await request.post(backend + '/api/test/reset') })

for (const kind of ['catalog', 'search', 'bookmarks'] as const) test(`${kind} loads the next page once at the scroll threshold`, async ({ page }) => {
  let page2Calls = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    const target = method === kind && (kind !== 'catalog' || params.category === 'films')
    if (!target) { await route.continue(); return }
    if (params.page === 2) { page2Calls++; await gate }
    const start = params.page === 2 ? 1036 : 1000
    await route.fulfill({ json: { returnValue: true, result: { page: params.page || 1, hasMore: params.page !== 2, items: Array.from({ length: params.page === 2 ? 5 : 36 }, (_, index) => item(start + index)) } } })
  })
  await page.goto('/')
  if (kind === 'catalog') await page.locator('[data-nav-id="nav-films"]').click()
  else if (kind === 'search') {
    await page.locator('[data-nav-id="nav-search"]').click()
    await page.getByLabel('Название фильма или сериала').fill('лента')
    await page.getByRole('button', { name: 'Найти', exact: true }).click()
  } else { await login(page); await page.locator('[data-nav-id="nav-bookmarks"]').click() }
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(36)
  const content = page.locator('.content-area')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
  await expect.poll(() => page2Calls).toBe(1)
  for (let index = 0; index < 5; index++) await content.evaluate(element => element.dispatchEvent(new Event('scroll')))
  expect(page2Calls).toBe(1)
  await expect(page.getByRole('button', { name: 'Показать ещё', exact: true })).toHaveCount(0)
  release()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(41)
  expect(await page.locator('.poster-grid .poster-card').evaluateAll(cards => new Set(cards.map(card => card.getAttribute('data-nav-id'))).size)).toBe(41)
})

test('a delayed lazy page cannot overwrite a new route or leave it loading', async ({ page }) => {
  let release!: () => void, markStarted!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method === 'catalog' && params.category === 'films') {
      if (params.page === 2) { markStarted(); await gate }
      await route.fulfill({ json: { returnValue: true, result: { page: params.page || 1, hasMore: params.page !== 2, items: Array.from({ length: 36 }, (_, index) => item((params.page === 2 ? 1100 : 1000) + index)) } } }); return
    }
    await route.continue()
  })
  await page.goto('/'); await page.locator('[data-nav-id="nav-films"]').click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(36)
  const content = page.locator('.content-area')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
  await started
  await page.locator('[data-nav-id="nav-search"]').click()
  release()
  await expect(page.getByLabel('Название фильма или сериала')).toBeVisible()
  await expect(page.locator('[data-nav-id^="catalog-"]')).toHaveCount(0)
  await expect(page.locator('[data-skeleton="grid"], .loading-line')).toHaveCount(0)
})

test('a failed lazy page stops, stays visible at the bottom and retries that page once', async ({ page }) => {
  let page2Calls = 0, fail = true
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'catalog' || params.category !== 'films') { await route.continue(); return }
    if (params.page === 2) {
      page2Calls++
      if (fail) { await route.fulfill({ json: { returnValue: false, errorCode: 'NETWORK_ERROR', errorText: 'Страница временно недоступна', retryable: true } }); return }
    }
    const start = params.page === 2 ? 1036 : 1000
    await route.fulfill({ json: { returnValue: true, result: { page: params.page || 1, hasMore: params.page !== 2, items: Array.from({ length: params.page === 2 ? 5 : 36 }, (_, index) => item(start + index)) } } })
  })
  await page.goto('/'); await page.locator('[data-nav-id="nav-films"]').click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(36)
  const content = page.locator('.content-area')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
  await expect(page.getByRole('alert')).toContainText('Страница временно недоступна')
  await page.waitForTimeout(300)
  expect(page2Calls).toBe(1)
  fail = false
  await page.getByRole('alert').getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(41)
  await expect(page.locator('.poster-grid .poster-card').nth(35)).toBeFocused()
  expect(page2Calls).toBe(2)
})

test('returning to a cached short page resumes automatic loading', async ({ page }) => {
  let page2Calls = 0
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'catalog' || params.category !== 'films') { await route.continue(); return }
    if (params.page === 2 && ++page2Calls === 1) {
      await route.fulfill({ json: { returnValue: false, errorCode: 'NETWORK_ERROR', errorText: 'Страница временно недоступна', retryable: true } })
      return
    }
    const start = params.page === 2 ? 2000 : 1000
    await route.fulfill({ json: { returnValue: true, result: { page: params.page || 1, hasMore: params.page !== 2, items: Array.from({ length: 2 }, (_, index) => item(start + index)) } } })
  })
  await page.goto('/'); await page.locator('[data-nav-id="nav-films"]').click()
  await expect(page.getByRole('alert')).toContainText('Страница временно недоступна')
  await page.locator('[data-nav-id="nav-search"]').click()
  await page.locator('[data-nav-id="nav-films"]').click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(4)
  expect(page2Calls).toBe(2)
})

test('short pages auto-fill and the 200-card cap preserves existing cards', async ({ page }) => {
  let mode: 'short' | 'cap' = 'short', page2Calls = 0, page3Calls = 0
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'catalog' || params.category !== 'films') { await route.continue(); return }
    if (params.page === 2) page2Calls++
    if (params.page === 3) page3Calls++
    const count = mode === 'short' ? 2 : params.page === 2 ? 20 : 190
    const start = params.page === 2 ? 2000 : 1000
    await route.fulfill({ json: { returnValue: true, result: { page: params.page || 1, hasMore: mode === 'cap' || params.page !== 2, items: Array.from({ length: count }, (_, index) => item(start + index)) } } })
  })
  await page.goto('/'); await page.locator('[data-nav-id="nav-films"]').click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(4)
  expect(page2Calls).toBe(1)

  mode = 'cap'; page2Calls = 0
  await page.reload(); await page.locator('[data-nav-id="nav-films"]').click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(190)
  const first = page.locator('[data-nav-id="catalog-1000"]')
  await first.evaluate((element: HTMLElement) => element.focus({ preventScroll: true }))
  const content = page.locator('.content-area')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(200)
  await expect(first).toBeFocused()
  expect(page2Calls).toBe(1)
  expect(page3Calls).toBe(0)
})

test('lazy-loading placeholders stay static while the user keeps scrolling', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'catalog' || params.category !== 'films') { await route.fallback(); return }
    if (params.page === 2) await gate
    await route.fulfill({ json: { returnValue: true, result: { page: params.page || 1, hasMore: params.page !== 2, items: Array.from({ length: params.page === 2 ? 4 : 36 }, (_, index) => item((params.page === 2 ? 2000 : 1000) + index)) } } })
  })
  await page.goto('/'); await page.locator('[data-nav-id="nav-films"]').click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(36)
  await page.locator('.content-area').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
  const appendSkeleton = page.locator('.poster-grid + [data-skeleton="grid"]')
  await expect(appendSkeleton).toBeVisible()
  expect(await appendSkeleton.locator('.skeleton-block').evaluateAll(blocks => blocks.every(block => getComputedStyle(block).animationName === 'none'))).toBe(true)
  release(); await expect(page.locator('.poster-grid .poster-card')).toHaveCount(40)
})
