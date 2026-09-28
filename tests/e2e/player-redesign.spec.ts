import { test, expect, type Page } from '@playwright/test'
import { chooseTvOption } from './tv-select'

const backend = 'http://127.0.0.1:5174'
async function openPlayer(page: Page, premium = true) {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method === 'progress') await route.fulfill({ json: { returnValue: true, result: null } })
    else await route.fallback()
  })
  await page.goto('/')
  if (premium) {
    await page.locator('[data-nav-id="nav-profile"]').click()
    await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
    await page.getByLabel('Логин или e-mail').fill('demo@example.test')
    await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
    await page.locator('[data-nav-id="nav-home"]').click()
    await page.locator('[data-nav-id="continue-100"]').click()
  } else await page.locator('[data-nav-id="new-200"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
}
test.beforeEach(async ({ request }) => { await request.post(backend + '/api/test/reset') })

test('remote and pointer playback actions show temporary feedback without persistent transport or sync banners', async ({ page, request }) => {
  await openPlayer(page)
  await page.locator('.player-stage').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(true)
  const flash = page.locator('[data-action-feedback]')
  await expect(flash).toHaveAttribute('data-action', 'pause', { timeout: 1000 })
  await expect(flash).toHaveCSS('opacity', '1')
  if (process.env.CAPTURE_PLAYER) await flash.screenshot({ path: 'artifacts/design/player-fixture-pause-flash.png', animations: 'disabled' })
  await expect(flash).toHaveCount(0)
  const before = await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)
  await page.locator('.player-stage').focus(); await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBeCloseTo(before + 10, 0)
  await expect(flash).toHaveAttribute('data-action', 'seek')
  await expect(flash).toContainText('+10')
  if (process.env.CAPTURE_PLAYER) await flash.screenshot({ path: 'artifacts/design/player-fixture-seek-flash.png', animations: 'disabled' })
  await page.locator('.player-stage').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(false)
  await expect(flash).toHaveAttribute('data-action', 'play')
  await expect(page.locator('.player .remote-hint, .player .sync-label, .player .sync-notice, .player .inline-error')).toHaveCount(0)
  for (const name of ['−10 сек', '+10 сек']) await expect(page.locator('.player').getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Пауза', exact: true })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Позиция видео' })).toBeVisible()
  await page.locator('.player-stage').click()
  await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).saves.at(-1)?.position).toBeGreaterThanOrEqual(before + 10)
})

test('a movie keeps play/pause as the first action below the timeline', async ({ page }) => {
  await openPlayer(page, false)
  const range = page.getByRole('slider', { name: 'Позиция видео' })
  const toggle = page.getByRole('button', { name: 'Пауза', exact: true })
  await expect(page.locator('.episode-actions').getByRole('button')).toHaveCount(1)
  await range.focus(); await page.keyboard.press('ArrowDown')
  await expect(toggle).toBeFocused()
})

for (const premium of [false, true]) test(`quality picker keeps every provider quality selectable for ${premium ? 'Premium' : 'guest'} playback`, async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('rezka.preferences', JSON.stringify({ quality: '1080p · MP4', autoNext: true }))
    const original = HTMLMediaElement.prototype.canPlayType
    HTMLMediaElement.prototype.canPlayType = function (mime: string) { return mime === 'application/vnd.apple.mpegurl' ? '' : original.call(this, mime) }
  })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'streams') { await route.fallback(); return }
    await route.fulfill({ json: { returnValue: true, result: { translatorId: params.translatorId, season: params.season, episode: params.episode, variants: [
      { id: '720p:0', label: '720p', height: 720, mime: 'video/mp4', url: '/api/test-video?quality=720' },
      { id: '1080p:1', label: '1080p', height: 1080, mime: 'video/mp4', url: '/api/test-video?quality=1080' },
      { id: '1080p Ultra:2', label: '1080p Ultra', height: 1080, mime: 'video/mp4', url: '/api/test-video?quality=ultra' },
      { id: '1080p Ultra:3', label: '1080p Ultra', height: 1080, mime: 'video/mp4', url: '/api/test-video?cdn=alternate' },
      { id: '1440p:4', label: '1440p', height: 1440, mime: 'video/mp4', url: '/api/test-video?quality=1440' },
      { id: '2160p:5', label: '2160p', height: 2160, mime: 'video/mp4', url: '/api/test-video?quality=2160' },
      { id: '4320p:6', label: '4320p', height: 4320, mime: 'application/vnd.apple.mpegurl', url: '/api/unsupported.m3u8' }
    ], subtitles: [] } } })
  })
  await openPlayer(page, premium)
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video?quality=1080', { timeout: 1000 })
  const quality = page.locator('.player').getByRole('combobox', { name: 'Качество', exact: true })
  await expect(page.locator('.player-quality')).toHaveAttribute('data-player-tooltip', 'Качество')
  await quality.click()
  const options = page.getByRole('option')
  expect(await options.evaluateAll(items => items.map(item => item.textContent?.replace('✓', '').trim()))).toEqual(['4K', '2K', '1080p Ultra', '1080p', '720p'])
  await page.keyboard.press('Escape')
  await chooseTvOption(page, quality, '4K')
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video?quality=2160')
  await chooseTvOption(page, quality, '2K')
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video?quality=1440')
  await chooseTvOption(page, quality, '1080p Ultra')
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video?quality=ultra')
  await chooseTvOption(page, quality, '1080p')
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video?quality=1080')
  await chooseTvOption(page, quality, '720p')
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video?quality=720')
  if (process.env.CAPTURE_PLAYER) {
    await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
    await page.screenshot({ path: 'artifacts/design/player-fixture-settings.png', animations: 'disabled' })
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rezka.preferences') || '{}').quality)).toBe('720p')
})

test('next episode shows a ten-second circular countdown that can be cancelled', async ({ page }) => {
  await openPlayer(page)
  await page.locator('video').evaluate(async element => { const video = element as HTMLVideoElement; video.currentTime = video.duration - 0.1; await video.play() })
  const countdown = page.locator('.next-countdown')
  await expect(countdown.locator('[data-countdown-ring]')).toBeVisible({ timeout: 1000 })
  await expect(countdown).toHaveAttribute('data-seconds', '10')
  if (process.env.CAPTURE_PLAYER) await page.screenshot({ path: 'artifacts/design/player-fixture-countdown.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'Отменить переход', exact: true }).click()
  await expect(countdown).toHaveCount(0)
  await expect(page.locator('.player-heading')).toContainText('Серия 1')
})

test('original format uses native proportional rectangles and fill crops without stretching', async ({ page }) => {
  await openPlayer(page)
  const video = page.locator('video')
  await video.evaluate(element => {
    Object.defineProperty(element, 'videoWidth', { configurable: true, value: 1920 })
    Object.defineProperty(element, 'videoHeight', { configurable: true, value: 800 })
    element.dispatchEvent(new Event('loadeddata'))
  })
  await expect.poll(() => video.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height }
  })).toEqual({ x: 0, y: 140, width: 1920, height: 800 })
  const format = page.getByRole('button', { name: 'Формат экрана', exact: true })
  await expect(format).toHaveAttribute('aria-disabled', 'false')
  await expect(format).toHaveAttribute('aria-pressed', 'false')
  await format.click()
  await expect(format).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => video.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height }
  })).toEqual({ x: -336, y: 0, width: 2592, height: 1080 })
  await format.click()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect.poll(() => video.evaluate(element => Math.round(parseFloat(element.style.width)))).toBe(1280)
  expect(await video.evaluate(element => parseFloat(element.style.width) / parseFloat(element.style.height))).toBeCloseTo(2.4, 5)
})

test('16:9 format control applies a moderate crop for letterboxed frames', async ({ page }) => {
  await openPlayer(page)
  const format = page.getByRole('button', { name: 'Формат экрана', exact: true })
  const video = page.locator('video')
  await expect(format).toHaveAttribute('aria-disabled', 'false')
  await expect(format).toHaveAttribute('data-player-tooltip', 'Оригинальный формат')
  await format.focus(); await expect(format).toBeFocused(); await page.keyboard.press('Enter')
  await expect(format).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => video.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height }
  })).toEqual({ x: -240, y: -135, width: 2400, height: 1350 })
})
