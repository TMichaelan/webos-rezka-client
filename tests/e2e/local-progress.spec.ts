import { test, expect, type Page } from '@playwright/test'
const backend = 'http://127.0.0.1:5174'
async function login(page: Page) {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.locator('[data-nav-id="continue-100"]')).toBeVisible()
}
async function openSeries(page: Page) {
  await page.locator('[data-nav-id="continue-100"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
}
test.beforeEach(async ({ request }) => { await request.post(backend + '/api/test/reset') })

test('guest playback, auto-next, close and reload never read or write account progress', async ({ page, request }) => {
  const methods: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('rezka.pending.https://hdrezka-home.tv.fixture-user', JSON.stringify([{ id: '100', translatorId: '1', season: 1, episode: 1, position: 44, duration: 120 }]))
  })
  await page.route('**/api/rpc', async route => {
    methods.push(route.request().postDataJSON().method)
    await route.continue()
  })
  await page.goto('/')
  await page.locator('[data-nav-id="new-100"]').click()
  await expect(page.locator('[data-nav-id="detail-bookmark"]')).toHaveCount(0)
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBeLessThan(10)
  await page.locator('video').evaluate(async element => { const video = element as HTMLVideoElement; video.currentTime = video.duration - 0.1; await video.play() })
  await page.getByRole('button', { name: 'Смотреть сейчас', exact: true }).click()
  await expect(page.locator('.player-heading')).toContainText('Серия 2')
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause())
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.locator('[data-nav-id="detail-play"]')).toBeFocused()
  await page.reload()
  await expect(page.locator('[data-nav-id="new-100"]')).toBeVisible()
  expect(methods.filter(method => ['bookmarkLists', 'bookmarks', 'setBookmark', 'continueWatching', 'progress', 'saveProgress', 'setEpisodeWatched'].includes(method))).toEqual([])
  expect((await (await request.get(backend + '/api/test/state')).json()).saves).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('rezka.pending.')))).toEqual(['rezka.pending.https://hdrezka-home.tv.fixture-user'])
})

test('seconds stay on this TV when episode synchronization fails and survive reload', async ({ page, request }) => {
  await login(page); await openSeries(page)
  await expect(page.getByRole('dialog', { name: 'Продолжить просмотр?' })).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await request.post(backend + '/api/test/fail-episode-sync')
  await page.locator('video').evaluate(v => { (v as HTMLVideoElement).currentTime = 45 })
  await page.locator('.player-stage').click()
  await expect(page.locator('.player').getByRole('button', { name: 'Повторить передачу серии', exact: true })).toBeVisible()
  await expect(page.getByText('Серия не передана в аккаунт', { exact: false })).toHaveCount(0)
  await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).progress['100'].position).toBeGreaterThanOrEqual(45)
  await page.reload()
  await openSeries(page)
  await expect(page.getByRole('dialog', { name: 'Продолжить просмотр?' })).toContainText('00:45')
  await expect(page.getByRole('dialog', { name: 'Продолжить просмотр?' })).toBeVisible()
})

test('episode from another device wins without borrowing local seconds from the previous episode', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'continueWatching') return route.continue()
    const response = await route.fetch(), json = await response.json()
    json.result.items[0].progress = { id: '100', translatorId: '2', season: 1, episode: 2, position: null, completed: false, positionSource: 'unavailable' }
    await route.fulfill({ json })
  })
  await login(page); await openSeries(page)
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await expect(page.getByRole('dialog', { name: 'Продолжить просмотр?' })).toHaveCount(0)
  await expect(page.locator('.player-heading')).toContainText('Серия 2')
  expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBeLessThan(10)
})

test('returning to visible Home refreshes the server episode without resetting focus or catalog', async ({ page }) => {
  let remoteEpisode = 1
  const calls = { continueWatching: 0, bookmarks: 0, catalog: 0 }
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    if (method in calls) calls[method as keyof typeof calls]++
    if (method !== 'continueWatching') { await route.continue(); return }
    const response = await route.fetch(), json = await response.json()
    json.result.items[0].progress = { id: '100', translatorId: '1', season: 1, episode: remoteEpisode, position: null, completed: false, positionSource: 'unavailable' }
    await route.fulfill({ response, json })
  })
  await login(page)
  const card = page.locator('[data-nav-id="continue-100"]')
  await expect(card).toContainText('Серия 1')
  await expect(page.locator('.loading-line')).toHaveCount(0)
  await page.locator('.content-area').evaluate(element => { element.scrollTop = 100 })
  await card.focus()
  const scroll = await page.locator('.content-area').evaluate(element => element.scrollTop)
  const before = { ...calls }
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  remoteEpisode = 2
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(card).toContainText('Серия 2', { timeout: 1500 })
  await expect(card).toBeFocused()
  expect(await page.locator('.content-area').evaluate(element => element.scrollTop)).toBe(scroll)
  expect(calls).toEqual({ continueWatching: before.continueWatching + 1, bookmarks: before.bookmarks + 1, catalog: before.catalog })
})
