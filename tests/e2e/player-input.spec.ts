import { test, expect, type Page } from '@playwright/test'
import { chooseTvOption } from './tv-select'
const backend = 'http://127.0.0.1:5174'
async function openPaused(page: Page) {
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
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(false)
  await page.locator('video').evaluate(v => { const media = v as HTMLVideoElement; media.pause(); media.currentTime = 30 })
  await expect(page.getByRole('slider', { name: 'Позиция видео' })).toHaveValue('30')
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).seeking)).toBe(false)
}
test.beforeEach(async ({ request }) => { await request.post(backend + '/api/test/reset') })

test('quality popup owns arrows and media seek keys even if player controls are hidden', async ({ page }) => {
  await openPaused(page)
  const quality = page.locator('.player').getByRole('combobox', { name: 'Качество', exact: true })
  await quality.click()
  await expect(page.getByRole('option', { selected: true })).toHaveAttribute('data-value', '720p')
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight')
  await page.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 417, key: 'MediaTrackNext', bubbles: true, cancelable: true })))
  expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBe(30)
  await expect(page.getByRole('dialog', { name: 'Качество', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(quality).toBeFocused()
})

test('subtitle popup owns arrows and media seek keys', async ({ page }) => {
  await openPaused(page)
  const subtitles = page.locator('.player').getByRole('combobox', { name: 'Субтитры', exact: true })
  await subtitles.click()
  await expect(page.getByRole('option', { selected: true })).toHaveAttribute('data-value', '')
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight')
  await page.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 417, key: 'MediaTrackNext', bubbles: true, cancelable: true })))
  expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBe(30)
  await expect(page.getByRole('dialog', { name: 'Субтитры', exact: true })).toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 461, bubbles: true, cancelable: true })))
  await expect(page.getByRole('dialog', { name: 'Субтитры', exact: true })).toHaveCount(0)
  await expect(subtitles).toBeFocused()
})

test('external subtitle tracks stay mounted through language and off/on switches', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method === 'subtitle') requests.push(params.url)
    await route.fallback()
  })
  await openPaused(page)
  const subtitles = page.locator('.player').getByRole('combobox', { name: 'Субтитры', exact: true })
  const state = () => page.locator('video').evaluate(element => Array.from(element.querySelectorAll('track')).map(node => ({ id: node.dataset.subtitleId, mode: node.track.mode })))
  const loaded = (id: string) => page.locator(`video track[data-subtitle-id="${id}"]`).evaluate(node => ({ readyState: node.readyState, mode: node.track.mode, text: node.track.cues?.[0] && (node.track.cues[0] as VTTCue).text }))
  await chooseTvOption(page, subtitles, 'ru')
  await expect.poll(state).toEqual([{ id: 'ru', mode: 'showing' }])
  await expect.poll(() => loaded('ru')).toEqual({ readyState: 2, mode: 'showing', text: 'Русские тестовые субтитры' })
  const russianSrc = await page.locator('video track[data-subtitle-id="ru"]').getAttribute('src')
  expect(russianSrc).toMatch(/^blob:/)
  await chooseTvOption(page, subtitles, 'en')
  await expect.poll(state).toEqual([{ id: 'ru', mode: 'disabled' }, { id: 'en', mode: 'showing' }])
  await expect.poll(() => loaded('en')).toEqual({ readyState: 2, mode: 'showing', text: 'English test subtitles' })
  const englishSrc = await page.locator('video track[data-subtitle-id="en"]').getAttribute('src')
  expect(englishSrc).toMatch(/^blob:/)
  await expect(page.getByRole('button', { name: 'Повторить загрузку субтитров', exact: true })).toHaveCount(0)
  await chooseTvOption(page, subtitles, 'ru')
  await expect.poll(state).toEqual([{ id: 'ru', mode: 'showing' }, { id: 'en', mode: 'disabled' }])
  await expect.poll(() => loaded('ru')).toEqual({ readyState: 2, mode: 'showing', text: 'Русские тестовые субтитры' })
  await expect(page.locator('video track[data-subtitle-id="ru"]')).toHaveAttribute('src', russianSrc!)
  await chooseTvOption(page, subtitles, '')
  await expect.poll(state).toEqual([{ id: 'ru', mode: 'disabled' }, { id: 'en', mode: 'disabled' }])
  await chooseTvOption(page, subtitles, 'ru')
  await expect.poll(state).toEqual([{ id: 'ru', mode: 'showing' }, { id: 'en', mode: 'disabled' }])
  await expect.poll(() => loaded('ru')).toEqual({ readyState: 2, mode: 'showing', text: 'Русские тестовые субтитры' })
  expect(requests.filter(url => url.endsWith('/ru.vtt'))).toHaveLength(1)
  expect(requests.filter(url => url.endsWith('/en.vtt'))).toHaveLength(1)
})

test('a failed subtitle can retry from the same selector without adding an unknown icon', async ({ page }) => {
  let failEnglish = true
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method === 'subtitle' && params.url.endsWith('/en.vtt') && failEnglish) {
      await route.fulfill({ json: { returnValue: false, errorCode: 'NETWORK_ERROR', errorText: 'Субтитры временно недоступны', retryable: true } })
    } else await route.fallback()
  })
  await openPaused(page)
  const subtitles = page.locator('.player').getByRole('combobox', { name: 'Субтитры', exact: true })
  await chooseTvOption(page, subtitles, 'en')
  await expect(page.locator('.player-subtitles')).toHaveAttribute('data-player-tooltip', /Субтитры временно недоступны/)
  await expect(page.locator('video track[data-subtitle-id="en"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Повторить загрузку субтитров', exact: true })).toHaveCount(0)
  failEnglish = false
  await chooseTvOption(page, subtitles, 'en')
  await expect.poll(() => page.locator('video track[data-subtitle-id="en"]').evaluate(node => ({ readyState: node.readyState, mode: node.track.mode, text: node.track.cues?.[0] && (node.track.cues[0] as VTTCue).text }))).toEqual({ readyState: 2, mode: 'showing', text: 'English test subtitles' })
  await expect(page.locator('video track[data-subtitle-id="en"]')).toHaveCount(1)
})

test('a late subtitle response cannot replace the newer language', async ({ page }) => {
  let releaseRussian!: () => void, russianStarted!: () => void, russianFinished!: () => void
  const gate = new Promise<void>(resolve => { releaseRussian = resolve })
  const started = new Promise<void>(resolve => { russianStarted = resolve })
  const finished = new Promise<void>(resolve => { russianFinished = resolve })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'subtitle' || !params.url.endsWith('/ru.vtt')) { await route.fallback(); return }
    russianStarted(); await gate
    await route.fulfill({ json: { returnValue: true, result: { text: 'WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nLate Russian subtitles\n' } } }).catch(() => {})
    russianFinished()
  })
  await openPaused(page)
  const subtitles = page.locator('.player').getByRole('combobox', { name: 'Субтитры', exact: true })
  await chooseTvOption(page, subtitles, 'ru'); await started
  await chooseTvOption(page, subtitles, 'en')
  await expect.poll(() => page.locator('video track[data-subtitle-id="en"]').evaluate(node => node.track.mode)).toBe('showing')
  releaseRussian(); await finished
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })
  await expect(page.locator('video track[data-subtitle-id="ru"]')).toHaveCount(0)
  await expect.poll(() => page.locator('video track[data-subtitle-id="en"]').evaluate(node => node.track.mode)).toBe('showing')
})

test('a fresh stream reload activates only the renewed track when its subtitle id stays the same', async ({ page }) => {
  let renewSource = false
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method === 'streams' && renewSource) {
      const response = await route.fetch(), json = await response.json()
      json.result.subtitles = json.result.subtitles.map((item: { id: string }) => item.id === 'ru' ? { ...item, url: 'https://subtitle.example.test/ru-renewed.vtt' } : item)
      await route.fulfill({ json }); return
    }
    if (method === 'subtitle' && params.url.endsWith('/ru-renewed.vtt')) {
      await route.fulfill({ json: { returnValue: true, result: { text: 'WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nRenewed Russian subtitles\n' } } }); return
    }
    await route.fallback()
  })
  await openPaused(page)
  const subtitles = page.locator('.player').getByRole('combobox', { name: 'Субтитры', exact: true })
  await chooseTvOption(page, subtitles, 'ru')
  await expect.poll(() => page.locator('video track[data-subtitle-id="ru"]').evaluate(node => node.track.cues?.[0] && (node.track.cues[0] as VTTCue).text)).toBe('Русские тестовые субтитры')
  renewSource = true
  await page.locator('video').dispatchEvent('error', { bubbles: false })
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click()
  const showing = () => page.locator('video').evaluate(element => Array.from(element.querySelectorAll('track')).filter(node => node.track.mode === 'showing').map(node => ({ readyState: node.readyState, text: node.track.cues?.[0] && (node.track.cues[0] as VTTCue).text })))
  await expect.poll(showing).toEqual([{ readyState: 2, text: 'Renewed Russian subtitles' }])
})

test('remote key repeats accelerate even when webOS reports repeat false and reset on direction change', async ({ page }) => {
  await openPaused(page)
  await page.evaluate(() => {
    let now = 0
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
    Object.assign(window, { setSeekClock(value: number) { now = value }, remoteKey(key: string, keyCode: number) { document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, repeat: false, bubbles: true, cancelable: true })) } })
  })
  await page.locator('.player-stage').focus()
  await page.evaluate(() => { (window as any).remoteKey('ArrowRight', 39); (window as any).setSeekClock(1100); (window as any).remoteKey('ArrowRight', 39); document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', keyCode: 39, bubbles: true })) })
  await expect(page.getByRole('slider', { name: 'Позиция видео' })).toHaveValue('70')
  await page.evaluate(() => { (window as any).setSeekClock(2000); (window as any).remoteKey('Unidentified', 412); (window as any).setSeekClock(3100); (window as any).remoteKey('Unidentified', 417); document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', keyCode: 417, bubbles: true })) })
  await expect(page.getByRole('slider', { name: 'Позиция видео' })).toHaveValue('70')
  await page.evaluate(() => { (window as any).setSeekClock(4000); (window as any).remoteKey('ArrowRight', 39); window.dispatchEvent(new PageTransitionEvent('pagehide')); window.dispatchEvent(new PageTransitionEvent('pageshow')); (window as any).setSeekClock(11000); (window as any).remoteKey('ArrowRight', 39); document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', keyCode: 39, bubbles: true })) })
  await expect(page.getByRole('slider', { name: 'Позиция видео' })).toHaveValue('90')
})

test('missing episode subtitles turn off without erasing the saved language', async ({ page }) => {
  await page.addInitScript(() => {
    const revoked: string[] = [], revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = value => { revoked.push(String(value)); revoke(value) }
    Object.assign(window, { revokedSubtitleUrls: revoked })
  })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'streams') { await route.fallback(); return }
    const response = await route.fetch(), json = await response.json()
    if (params.episode === 2) json.result.subtitles = []
    await route.fulfill({ json })
  })
  await openPaused(page)
  const subtitles = page.locator('.player').getByRole('combobox', { name: 'Субтитры', exact: true })
  await chooseTvOption(page, subtitles, 'ru')
  const russianTrack = page.locator('video track[data-subtitle-id="ru"]')
  await expect.poll(() => russianTrack.evaluate(node => node.track.mode)).toBe('showing')
  const oldSource = await russianTrack.getAttribute('src')
  await page.getByRole('button', { name: 'Следующая серия', exact: true }).click()
  await expect(page.locator('.player-heading')).toContainText('Серия 2')
  await expect(page.locator('.player-skeleton')).toHaveCount(0)
  await expect(subtitles).toBeDisabled()
  await expect(subtitles).toHaveAttribute('data-value', '')
  await expect(page.locator('video track')).toHaveCount(0)
  await expect.poll(() => page.locator('video').evaluate(element => element.textTracks.length)).toBe(0)
  await expect.poll(() => page.evaluate(source => (window as any).revokedSubtitleUrls.includes(source), oldSource)).toBe(true)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rezka.preferences') || '{}').subtitleId)).toBe('ru')
  await page.getByRole('button', { name: 'Предыдущая серия', exact: true }).click()
  await expect(page.locator('.player-heading')).toContainText('Серия 1')
  await expect(subtitles).toBeEnabled()
  await expect(subtitles).toHaveAttribute('data-value', 'ru')
  await expect.poll(() => russianTrack.evaluate(node => node.track.mode)).toBe('showing')
  expect(await russianTrack.getAttribute('src')).not.toBe(oldSource)
})

test('held seek accumulates intended targets while native getters and events lag', async ({ page, request }) => {
  await openPaused(page)
  await page.locator('video').evaluate(element => {
    const media = element as HTMLVideoElement
    let reported = 30, seeking = false
    const writes: number[] = []
    Object.defineProperty(media, 'currentTime', { configurable: true, get: () => reported, set: value => { writes.push(value); seeking = true } })
    Object.defineProperty(media, 'seeking', { configurable: true, get: () => seeking })
    Object.assign(window, { seekWrites: writes, reportTime(value: number, settled = false) { reported = value; seeking = !settled; media.dispatchEvent(new Event(settled ? 'seeked' : 'timeupdate')) } })
  })
  await page.locator('.player-stage').focus()
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(200); await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(200); await page.keyboard.down('ArrowRight')
  await page.keyboard.up('ArrowRight')
  const range = page.getByRole('slider', { name: 'Позиция видео' })
  await expect(range).toHaveValue('60')
  expect(await page.evaluate(() => (window as any).seekWrites)).toEqual([40])
  await page.evaluate(() => (window as any).reportTime(30))
  await page.locator('video').dispatchEvent('loadedmetadata')
  await expect(range).toHaveValue('60')
  expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(true)
  expect(await page.evaluate(() => (window as any).seekWrites)).toEqual([40])
  await page.evaluate(() => (window as any).reportTime(40, true))
  expect(await page.evaluate(() => (window as any).seekWrites)).toEqual([40, 60])
  await page.evaluate(() => (window as any).reportTime(30))
  await expect(range).toHaveValue('60')
  await page.evaluate(() => (window as any).reportTime(58, true))
  await expect(range).toHaveValue('58')
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).saves.at(-1)?.position).toBe(58)
})

test('quality reload preserves paused intent and repeated metadata never seeks back or resumes', async ({ page }) => {
  await openPaused(page)
  await chooseTvOption(page, page.locator('.player').getByRole('combobox', { name: 'Качество', exact: true }), '360p')
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).seeking)).toBe(false)
  expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(true)
  await page.locator('video').evaluate(element => { const media = element as HTMLVideoElement; media.currentTime = 45 })
  await expect(page.getByRole('slider', { name: 'Позиция видео' })).toHaveValue('45')
  await page.locator('video').dispatchEvent('loadedmetadata')
  await page.locator('video').dispatchEvent('durationchange')
  await expect(page.getByRole('slider', { name: 'Позиция видео' })).toHaveValue('45')
  expect(await page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(true)
})

test('a delayed earlier stream retry cannot replace the latest retry source', async ({ page }) => {
  await openPaused(page)
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const firstStarted = new Promise<void>(resolve => { started = resolve })
  let retries = 0
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'streams') { await route.fallback(); return }
    const order = ++retries
    if (order === 1) { started(); await gate }
    const tag = order === 1 ? 'old' : 'new'
    await route.fulfill({ headers: { 'Content-Type': 'application/json', 'X-Test-Retry': tag }, json: { returnValue: true, result: { translatorId: params.translatorId, season: params.season, episode: params.episode, variants: [{ id: tag, label: '720p', height: 720, mime: 'video/mp4', url: `/api/test-video?retry=${tag}` }], subtitles: [] } } })
  })
  await page.locator('video').dispatchEvent('error', { bubbles: false })
  const retry = page.getByRole('button', { name: 'Повторить загрузку', exact: true })
  await retry.click(); await firstStarted; await retry.click()
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video?retry=new')
  const older = page.waitForResponse(response => response.headers()['x-test-retry'] === 'old')
  release(); await older
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video?retry=new')
})

test('native playback error focuses a keyboard-reachable fresh stream retry', async ({ page }) => {
  await openPaused(page)
  let retries = 0
  await page.route('**/api/rpc', async route => { if (route.request().postDataJSON().method === 'streams') retries++; await route.fallback() })
  await page.locator('video').dispatchEvent('error', { bubbles: false })
  await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => retries).toBe(1)
  await expect(page.locator('.player-error')).toHaveCount(0)
  await expect(page.locator('video')).toBeVisible()
})
