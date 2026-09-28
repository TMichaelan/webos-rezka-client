import { test, expect, type Page } from '@playwright/test'
import { chooseTvOption } from './tv-select'

const backend = 'http://127.0.0.1:5174'
const series = { id: '100', url: 'https://hdrezka-home.tv/series/100-test.html', title: 'Тестовый сериал', type: 'series' }
const movie = { id: '200', url: 'https://hdrezka-home.tv/films/200-test.html', title: 'Тестовый фильм', type: 'movie' }
async function login(page: Page) {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.getByRole('heading', { name: 'Что посмотрим сегодня?' })).toBeVisible()
}
async function listsFixture(page: Page) {
  let list2 = [movie]
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    let result
    if (method === 'bookmarkLists') result = [{ id: '1', name: 'Избранное' }, { id: '2', name: 'Посмотреть позже' }]
    else if (method === 'bookmarks') result = { items: params.listId === '2' ? list2 : params.listId === '1' ? [series] : [series, ...list2], page: 1, hasMore: false }
    else if (method === 'setBookmark' && params.listId === '2') { list2 = params.added ? [movie] : []; result = { success: true } }
    else { await route.continue(); return }
    await route.fulfill({ json: { returnValue: true, result } })
  })
}
test.beforeEach(async ({ request }) => { await request.post(backend + '/api/test/reset') })

test('Down from Watch moves to the voiceover selector', async ({ page }) => {
  await login(page)
  const watch = page.locator('[data-nav-id="detail-play"]')
  await page.locator('[data-nav-id="continue-100"]').click()
  await expect(watch).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const voiceover = page.getByRole('combobox', { name: 'Озвучка', exact: true })
  await expect(voiceover).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(watch).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-nav-id="detail-bookmark"]')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(watch).toBeFocused()
})

test('Home has no duplicate All bookmarks action', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('button', { name: 'Все закладки →', exact: true })).toHaveCount(0)
})

test('detail shows confirmed bookmark membership', async ({ page }) => {
  await login(page)
  await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await page.locator('[data-nav-id="bookmarks-100"]').click()
  await expect(page.locator('[data-nav-id="detail-bookmark"]')).toHaveText('В закладках')
  await expect(page.locator('[data-nav-id="detail-bookmark"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-nav-id="detail-bookmark"]')).toHaveClass(/bookmarked/)
})

test('detail keeps bookmark membership neutral when only a partial list is known', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'bookmarks') { await route.fallback(); return }
    await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: true, items: [{ id: '100', title: 'Тестовый сериал', url: 'https://hdrezka-home.tv/series/100-test.html', type: 'series' }] } } })
  })
  await login(page); await page.locator('[data-nav-id="new-200"]').click()
  const bookmark = page.locator('[data-nav-id="detail-bookmark"]')
  await expect(bookmark).toHaveText('Закладки')
  await expect(bookmark).not.toHaveAttribute('aria-pressed')
})

test('the 200-card UI cap never pretends the bookmark account list is complete', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'bookmarks') { await route.fallback(); return }
    await route.fulfill({ json: { returnValue: true, result: { page: 1, hasMore: true, items: Array.from({ length: 200 }, (_, index) => ({ id: String(1000 + index), title: `Закладка ${index + 1}`, url: `https://hdrezka-home.tv/films/fiction/${1000 + index}-test.html`, type: 'movie' })) } } })
  })
  await login(page); await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(200)
  await page.locator('[data-nav-id="nav-films"]').click(); await page.locator('[data-nav-id="catalog-300"]').click()
  await expect(page.locator('[data-nav-id="detail-bookmark"]')).toHaveText('Закладки')
  await expect(page.locator('[data-nav-id="detail-bookmark"]')).not.toHaveAttribute('aria-pressed')
})

test('voiceover Up is not swallowed when Watch is unavailable', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'details') { await route.fallback(); return }
    const response = await route.fetch(), json = await response.json(); json.result.episodes = []
    await route.fulfill({ json })
  })
  await login(page); await page.locator('[data-nav-id="continue-100"]').click()
  const voiceover = page.getByRole('combobox', { name: 'Озвучка', exact: true })
  await voiceover.focus()
  await page.evaluate(() => { (window as any).sawVoiceoverUp = false; document.addEventListener('keydown', event => { if (event.key === 'ArrowUp') (window as any).sawVoiceoverUp = true }, { once: true }) })
  await page.keyboard.press('ArrowUp')
  expect(await page.evaluate(() => (window as any).sawVoiceoverUp)).toBe(true)
})

test('successful bookmark changes update the detail quietly', async ({ page }) => {
  await login(page)
  await page.locator('[data-nav-id="nav-films"]').click()
  const card = page.locator('[data-nav-id="catalog-200"]')
  await card.click()
  const bookmark = page.locator('[data-nav-id="detail-bookmark"]')
  await expect(bookmark).toHaveText('В закладки')
  await bookmark.click()
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(bookmark).toHaveText('В закладках')
  await expect(bookmark).toHaveAttribute('aria-pressed', 'true')
  await expect(bookmark).toHaveClass(/bookmarked/)
  await expect(page.getByText('Добавлено в список аккаунта.', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(card).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(bookmark).toHaveText('В закладках')
})

test('a late bookmark mutation cannot mark another detail', async ({ page, request }) => {
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const mutationStarted = new Promise<void>(resolve => { started = resolve })
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method === 'setBookmark') { started(); await gate }
    await route.continue()
  })
  await login(page)
  await page.locator('[data-nav-id="new-200"]').click()
  await page.locator('[data-nav-id="detail-bookmark"]').click()
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await mutationStarted
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.locator('[data-nav-id="new-300"]').click()
  await expect(page.locator('[data-nav-id="detail-bookmark"]')).toHaveText('В закладки')
  release()
  await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).bookmarks).toContain('200')
  await expect(page.locator('[data-nav-id="detail-bookmark"]')).toHaveText('В закладки')
})

test('bookmark cache follows the selected list when the modal changes it', async ({ page }) => {
  await listsFixture(page); await login(page)
  await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await expect(page.locator('.poster-grid .poster-card')).toHaveCount(2)
  await page.locator('[data-nav-id="bookmarks-100"]').click()
  await page.locator('[data-nav-id="detail-bookmark"]').click()
  await chooseTvOption(page, page.getByRole('combobox', { name: 'Выберите список', exact: true }), '2')
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await expect(page.getByRole('combobox', { name: 'Список аккаунта', exact: true })).toHaveAttribute('data-value', '2')
  await expect(page.locator('[data-nav-id="bookmarks-200"]')).toBeVisible()
  await expect(page.locator('[data-nav-id="bookmarks-100"]')).toHaveCount(0)
})

test('successful bookmark mutation invalidates previously visited lists', async ({ page }) => {
  await listsFixture(page); await login(page)
  await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await chooseTvOption(page, page.getByRole('combobox', { name: 'Список аккаунта', exact: true }), '2')
  await page.locator('[data-nav-id="bookmarks-200"]').click()
  await page.locator('[data-nav-id="detail-bookmark"]').click()
  await page.getByRole('button', { name: 'Удалить из списка', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await expect(page.locator('[data-nav-id="bookmarks-200"]')).toHaveCount(0)
  await expect(page.getByText('Ничего не найдено', { exact: true })).toBeVisible()
  await expect(page.locator('.empty-state, .empty-icon')).toHaveCount(0)
  await expect(page.getByText('В этом разделе пока нет доступных записей.', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Обновить/ })).toHaveCount(0)
})

test('account transition drops prior private caches and navigation history', async ({ page }) => {
  let switched = false
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    let result
    if (method === 'status' && switched) result = { account: { id: 'account-b', name: 'Другой аккаунт', premium: true }, mirror: 'https://hdrezka-home.tv', capabilities: { progress: true, watched: true }, warnings: [] }
    else if (method === 'bookmarks') result = { items: switched ? [movie] : [series], page: 1, hasMore: false }
    else if (method === 'bookmarkLists') result = [{ id: switched ? 'b' : 'a', name: switched ? 'Список B' : 'Список A' }]
    else if (method === 'continueWatching') result = { items: [], page: 1, hasMore: false }
    else { await route.continue(); return }
    await route.fulfill({ json: { returnValue: true, result } })
  })
  await login(page)
  await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await expect(page.locator('[data-nav-id="bookmarks-100"]')).toBeVisible()
  switched = true
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.locator('.sidebar-account')).toHaveAttribute('aria-label', 'Профиль аккаунта Другой аккаунт')
  await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await expect(page.locator('[data-nav-id="bookmarks-200"]')).toBeVisible()
  await expect(page.locator('[data-nav-id="bookmarks-100"]')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Список аккаунта', exact: true }).click()
  await expect(page.getByRole('option', { name: 'Список B', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Список A', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Что посмотрим сегодня?' })).toBeVisible()
})

test('card voice and episode survive playback, Back, reopen, and automatic next episode', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    if (method === 'progress') await route.fulfill({ json: { returnValue: true, result: null } })
    else await route.continue()
  })
  await login(page)
  await page.locator('[data-nav-id="continue-100"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('.player-stage').focus(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(page.locator('video')).toHaveCount(0)
  await page.locator('[data-nav-id="episode-1-2"]').click()
  await chooseTvOption(page, page.getByRole('combobox', { name: 'Озвучка', exact: true }), '2')
  await expect(page.locator('[data-nav-id="episode-1-2"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect(page.locator('.player-heading')).toContainText('Серия 2')
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Озвучка', exact: true })).toHaveAttribute('data-value', '2')
  await expect(page.locator('[data-nav-id="detail-play"]')).toContainText('2 серия')
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect(page.locator('.player-heading')).toContainText('Серия 2')
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('video').evaluate(async element => { const video = element as HTMLVideoElement; video.currentTime = video.duration - 0.1; await video.play() })
  await page.getByRole('button', { name: 'Смотреть сейчас', exact: true }).click()
  await expect(page.locator('.player-heading')).toContainText('Серия 3')
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(page.locator('[data-nav-id="detail-play"]')).toContainText('3 серия')
  await expect(page.getByRole('combobox', { name: 'Озвучка', exact: true })).toHaveAttribute('data-value', '2')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rezka.preferences') || '{}').translatorId)).toBe('2')
})

test('technical progress hints are hidden without hiding other server warnings', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    if (method !== 'status') { await route.continue(); return }
    await route.fulfill({ json: { returnValue: true, result: { account: { id: 'fixture-user', name: 'Тест', premium: true }, mirror: 'https://hdrezka-home.tv', capabilities: { progress: false, watched: true }, warnings: ['Синхронизация точной позиции недоступна.', 'Premium нужно проверить отдельно.'] } } })
  })
  await page.goto('/')
  await expect(page.locator('.warning-strip').filter({ hasText: 'Синхронизация точной позиции недоступна' })).toHaveCount(0)
  await expect(page.getByText('Premium нужно проверить отдельно.', { exact: false })).toBeVisible()
})

test('direct quality picker offers only supported resolutions and can return to the highest one', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.canPlayType
    HTMLMediaElement.prototype.canPlayType = function (mime: string) { return mime === 'application/vnd.apple.mpegurl' ? '' : original.call(this, mime) }
  })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method === 'progress') { await route.fulfill({ json: { returnValue: true, result: null } }); return }
    if (method !== 'streams') { await route.continue(); return }
    await route.fulfill({ json: { returnValue: true, result: { translatorId: params.translatorId, season: params.season, episode: params.episode, variants: [{ id: '2160p', label: '2160p unsupported', height: 2160, mime: 'application/vnd.apple.mpegurl', url: '/api/unsupported.m3u8' }, { id: '720p', label: '720p supported', height: 720, mime: 'video/mp4', url: '/api/test-video' }, { id: '360p', label: '360p supported', height: 360, mime: 'video/mp4', url: '/api/test-video?quality=360' }], subtitles: [] } } })
  })
  await login(page)
  await page.locator('[data-nav-id="continue-100"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  const quality = page.locator('.player').getByRole('combobox', { name: 'Качество', exact: true })
  await expect(quality).toHaveAttribute('data-value', '720p')
  await quality.click()
  expect(await page.getByRole('option').evaluateAll(options => options.map(option => (option as HTMLElement).dataset.value))).toEqual(['720p', '360p'])
  await page.keyboard.press('Escape')
  await chooseTvOption(page, quality, '360p')
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video?quality=360')
  await chooseTvOption(page, quality, '720p')
  await expect(quality).toHaveAttribute('data-value', '720p')
  await expect(page.locator('video')).toHaveAttribute('src', '/api/test-video')
})

for (const destination of ['home', 'bookmarks'] as const) {
  test(`pending bookmark mutation refreshes the visible ${destination} after Back`, async ({ page, request }) => {
    let releaseMutation!: () => void
    let markStarted!: () => void
    const gate = new Promise<void>(resolve => { releaseMutation = resolve })
    const started = new Promise<void>(resolve => { markStarted = resolve })
    await page.route('**/api/rpc', async route => {
      if (route.request().postDataJSON().method === 'setBookmark') { markStarted(); await gate }
      await route.continue()
    })
    await login(page)
    if (destination === 'home') await page.locator('[data-nav-id="new-200"]').click()
    else {
      await page.locator('[data-nav-id="nav-bookmarks"]').click()
      await page.locator('[data-nav-id="bookmarks-100"]').click()
    }
    await page.locator('[data-nav-id="detail-bookmark"]').click()
    await page.getByRole('button', { name: destination === 'home' ? 'Добавить' : 'Удалить из списка', exact: true }).click()
    await started
    await page.keyboard.press('Escape')
    const oldListLoaded = page.waitForResponse(response => response.url().endsWith('/api/rpc') && response.request().postDataJSON().method === 'bookmarks')
    await page.keyboard.press('Escape')
    await oldListLoaded
    await expect(page.locator('.loading-line')).toHaveCount(0)
    await expect(page.locator('[data-nav-id="bookmarks-100"]')).toBeVisible()
    releaseMutation()
    await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).bookmarks).toEqual(destination === 'home' ? ['100', '200'] : [])
    if (destination === 'home') {
      await expect(page.locator('[data-nav-id="bookmarks-100"]')).toBeVisible()
      await expect(page.locator('[data-nav-id="bookmarks-200"]')).toBeVisible()
    } else {
      await expect(page.locator('[data-nav-id="bookmarks-100"]')).toHaveCount(0)
      await expect(page.getByText('Ничего не найдено', { exact: true })).toBeVisible()
    }
  })
}

test('automatic episode marking retains a quiet retry after a network failure', async ({ page, request }) => {
  let fail = true
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method === 'setEpisodeWatched' && fail) await route.fulfill({ json: { returnValue: false, errorCode: 'NETWORK_ERROR', errorText: 'Не удалось обновить отметку', retryable: true } })
    else await route.continue()
  })
  await login(page)
  await page.locator('[data-nav-id="continue-100"]').click()
  await expect(page.getByRole('button', { name: /Отметить серию просмотренной|Снять отметку о просмотре/ })).toHaveCount(0)
  await page.locator('[data-nav-id="detail-play"]').click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('video').evaluate(async element => { const v = element as HTMLVideoElement; v.currentTime = v.duration - 0.1; await v.play() })
  await page.getByRole('button', { name: 'Отменить переход', exact: true }).click()
  const retry = page.locator('.player').getByRole('button', { name: 'Повторить отметки просмотра', exact: true })
  await expect(retry).toBeVisible()
  fail = false
  await retry.click()
  await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).watched['100:1:1']).toBe(true)
  await expect(retry).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-nav-id="episode-1-1"]')).toContainText('Просмотрено')
})

test('episode completion marks the actual episode despite unsupported exact-position saving', async ({ page, request }) => {
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    if (method === 'saveProgress') await route.fulfill({ json: { returnValue: false, errorCode: 'UNSUPPORTED_PROTOCOL', errorText: 'Точная позиция недоступна', retryable: false } })
    else if (method === 'progress') await route.fulfill({ json: { returnValue: true, result: null } })
    else if (method === 'status' || method === 'login') {
      const response = await route.fetch(); const json = await response.json()
      json.result.capabilities.progress = false
      await route.fulfill({ response, json })
    } else await route.continue()
  })
  await login(page)
  await page.locator('[data-nav-id="continue-100"]').click()
  await page.locator('[data-nav-id="episode-1-2"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('video').evaluate(async element => { const video = element as HTMLVideoElement; video.currentTime = video.duration - 0.1; await video.play() })
  await page.getByRole('button', { name: 'Отменить переход', exact: true }).click()
  await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).watched?.['100:1:2'], { timeout: 1000 }).toBe(true)
  await expect(page.locator('.player .sync-notice, .player .inline-error, .player .sync-label')).toHaveCount(0)
  await expect(page.getByText('Позиция сохранена в аккаунте', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-nav-id="episode-1-2"]')).toContainText('Просмотрено')
  expect((await (await request.get(backend + '/api/test/state')).json()).watched['100:1:1']).toBeUndefined()
})
