import { test, expect, type Page } from '@playwright/test'
import { chooseTvOption } from './tv-select'

const backend = 'http://127.0.0.1:5174'

async function openPlayer(page: Page) {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method === 'progress') await route.fulfill({ json: { returnValue: true, result: null } })
    else await route.fallback()
  })
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await page.locator('[data-nav-id="continue-100"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('video').evaluate(async element => { const video = element as HTMLVideoElement; video.currentTime = 25; await video.play() })
}

test.beforeEach(async ({ request }) => { await request.post(backend + '/api/test/reset') })

for (const event of ['visibilitychange', 'pagehide']) {
  test(`${event} pauses playback and saves the current position`, async ({ page, request }) => {
    await openPlayer(page)
    await page.evaluate(event => {
      if (event === 'visibilitychange') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true })
        document.dispatchEvent(new Event(event))
      } else window.dispatchEvent(new PageTransitionEvent(event))
    }, event)
    await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(true)
    await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).saves.at(-1)?.position).toBeGreaterThanOrEqual(25)
    const stopped = await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(true)
    expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBe(stopped)
  })
}

test('closing releases the detached native player without saving a cleared position', async ({ page, request }) => {
  await openPlayer(page)
  const video = await page.locator('video').elementHandle()
  await page.locator('.player-stage').focus(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(page.locator('video')).toHaveCount(0)
  await expect.poll(() => video!.evaluate(v => ({ paused: v.paused, source: v.getAttribute('src'), ready: v.readyState, network: v.networkState, buffered: v.buffered.length }))).toEqual({ paused: true, source: null, ready: 0, network: 0, buffered: 0 })
  await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).saves.at(-1)?.position).toBeGreaterThanOrEqual(25)
  const saves = (await (await request.get(backend + '/api/test/state')).json()).saves
  expect(saves.every((save: { position: number }) => save.position >= 25)).toBe(true)
})

test('hiding the player cancels the next-episode countdown', async ({ page }) => {
  await openPlayer(page)
  await page.locator('video').evaluate(async video => { video.currentTime = video.duration - 0.1; await video.play() })
  await expect(page.getByRole('button', { name: 'Отменить переход', exact: true })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('button', { name: 'Отменить переход', exact: true })).toHaveCount(0)
})

test('Back during a card translator read cannot reopen playback or request the stale voice', async ({ page }) => {
  let release!: () => void
  let markStarted!: () => void
  let markFinished!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  const finished = new Promise<void>(resolve => { markFinished = resolve })
  const streams: string[] = []
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method === 'streams') streams.push(params.translatorId)
    if (method === 'details' && params.translatorId === '2') {
      const response = await route.fetch()
      markStarted(); await gate
      await route.fulfill({ response }).catch(() => {})
      markFinished()
    } else await route.fallback()
  })
  await openPlayer(page)
  const video = await page.locator('video').elementHandle()
  await page.locator('.player-stage').focus(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(page.locator('video')).toHaveCount(0)
  await chooseTvOption(page, page.getByRole('combobox', { name: 'Озвучка', exact: true }), '2')
  await started
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Что посмотрим сегодня?' })).toBeVisible()
  release(); await finished
  await expect.poll(() => video!.evaluate(v => ({ paused: v.paused, source: v.getAttribute('src'), ready: v.readyState, network: v.networkState, buffered: v.buffered.length }))).toEqual({ paused: true, source: null, ready: 0, network: 0, buffered: 0 })
  expect(streams).not.toContain('2')
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Озвучка', exact: true })).toHaveCount(0)
})
