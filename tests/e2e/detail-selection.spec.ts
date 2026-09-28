import { test, expect, type Page } from '@playwright/test'
import { chooseTvOption } from './tv-select'

const backend = 'http://127.0.0.1:5174'
async function detail(page: Page) {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await page.locator('[data-nav-id="continue-100"]').click()
  await expect(page.getByRole('heading', { name: 'Тестовый сериал', exact: true })).toBeVisible()
}
test.beforeEach(async ({ request }) => { await request.post(backend + '/api/test/reset') })

test('Films contains only movies and a movie card has no season or episodes', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await page.locator('[data-nav-id="nav-films"]').click()
  await expect(page.locator('[data-nav-id="catalog-200"]')).toBeVisible()
  await expect(page.locator('[data-nav-id="catalog-100"]')).toHaveCount(0)
  await page.locator('[data-nav-id="catalog-200"]').click()
  await expect(page.getByRole('heading', { name: 'Тестовый фильм', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Сезон', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Выбор серии' })).toHaveCount(0)
})

test('fixture metadata covers completed and ongoing series plus a movie', async ({ request }) => {
  const details = async (url: string) => {
    const response = await request.post(backend + '/api/rpc', { data: { method: 'details', params: { url } } })
    return (await response.json()).result
  }
  const completed = await details('https://hdrezka-home.tv/series/100-test.html')
  expect(completed).toMatchObject({ status: 'Завершён', originalTitle: 'Test Series', releaseDate: '15 сентября 2024 года', countries: ['США', 'Канада'], ageRating: '16+', ratings: [{ source: 'IMDb', score: '8.4', votes: '12 345' }, { source: 'Кинопоиск', score: '7.9', votes: '2 345' }, { source: 'HDRezka', score: '8.2', votes: '456' }] })
  expect(completed.episodes.length).toBeGreaterThan(0)
  const ongoing = await details('https://hdrezka-home.tv/series/400-test.html')
  expect(ongoing).toMatchObject({ status: 'Выходит', year: '2022', ratings: [{ source: 'IMDb', score: '7.5' }] })
  const movie = await details('https://hdrezka-home.tv/films/200-test.html')
  expect(movie).toMatchObject({ type: 'movie', originalTitle: 'Test Movie', releaseDate: '10 мая 2026 года', countries: ['Франция'], ageRating: '18+' })
  expect(movie.episodes).toEqual([])
  expect(movie.status).toBeUndefined()
})

test('detail shows source-labelled ratings, release facts and genres without poster overlays', async ({ page }) => {
  await detail(page)
  await expect(page.locator('.detail-original-title')).toHaveText('Test Series')
  await expect(page.getByRole('list', { name: 'Рейтинги' }).getByRole('listitem')).toHaveText(['IMDb8.412 345 голосов', 'Кинопоиск7.92 345 голосов', 'HDRezka8.2456 голосов'])
  await expect(page.locator('.detail-artwork .detail-rating')).toHaveCount(0)
  await expect(page.locator('.detail-facts dd')).toHaveText(['15 сентября 2024 года', '2022–2024', 'Завершён', 'США, Канада', '45 мин', '16+'])
  await expect(page.getByRole('list', { name: 'Жанры' }).getByRole('listitem')).toHaveText(['Драма'])
  await page.screenshot({ path: test.info().outputPath('detail-metadata.png') })
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-nav-id="continue-100"]')).toBeFocused()
})

test('ongoing summary survives voice reloads and a movie cannot inherit series facts', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'details') return route.continue()
    const response = await route.fetch(), json = await response.json()
    delete json.result.meta
    delete json.result.status
    if (json.result.type === 'movie') json.result.status = 'Завершён'
    await route.fulfill({ json })
  })
  await page.goto('/')
  await page.locator('[data-nav-id="new-400"]').click()
  await expect(page.locator('.detail-facts dd')).toContainText(['2022–…', 'Выходит'])
  await expect(page.getByRole('list', { name: 'Рейтинги' }).getByRole('listitem')).toHaveText(['IMDb7.5'])
  await page.locator('[data-nav-id="episode-1-2"]').click()
  await chooseTvOption(page, page.getByRole('combobox', { name: 'Озвучка', exact: true }), '2')
  await expect(page.locator('.title-detail')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.detail-facts dd')).toContainText(['2022–…', 'Выходит'])
  await expect(page.locator('[data-nav-id="episode-1-2"]')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await page.locator('[data-nav-id="new-200"]').click()
  await expect(page.locator('.detail-original-title')).toHaveText('Test Movie')
  await expect(page.locator('.detail-facts dd')).toHaveText(['10 мая 2026 года', 'Франция', '124 мин', '18+'])
  await expect(page.getByRole('list', { name: 'Рейтинги' })).toContainText('World Art')
  await expect(page.getByRole('region', { name: 'Выбор серии' })).toHaveCount(0)
})

for (const summary of [
  { meta: '2020–2024 · Сериал', status: 'Сериал завершен', state: 'Завершён', years: '2020–2024' },
  { meta: '2020–2024 · Сериал', status: '', state: '', years: '2020–2024' },
  { meta: '2020–2024 · Сериал', status: 'Сериал не завершен', state: '', years: '2020–2024' },
  { meta: '2020–2024 · Сериал', status: '1 сезон завершен', state: '', years: '2020–2024' },
  { meta: '2022 - ... · Сериал', status: 'Сериал не завершен', state: 'Выходит', years: '2022–…' },
  { meta: '2022 - ... · Сериал', status: '1 сезон завершен', state: 'Выходит', years: '2022–…' },
  { meta: '2020–2024 · Сериал', status: 'Завершен (все серии)', state: 'Завершён', years: '2020–2024' },
  { meta: '2020–2024 · Сериал', status: 'проект завершен', state: 'Завершён', years: '2020–2024' },
  { meta: '2022 - ... · Сериал', status: '', state: 'Выходит', years: '2022–…' },
  { meta: '2024 · Сериал', status: '1 сезон, 2 серия', state: '', years: '' },
]) test(`sparse details use only explicit summary state: ${summary.meta}, ${summary.status || 'no state'}`, async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    if (method !== 'catalog' && method !== 'details') return route.continue()
    const response = await route.fetch(), json = await response.json()
    if (method === 'catalog') Object.assign(json.result.items[0], summary)
    else {
      for (const key of ['meta', 'status', 'year', 'releaseDate', 'originalTitle', 'countries', 'ageRating', 'duration', 'ratings', 'genres', 'rating']) delete json.result[key]
      Object.assign(json.result, { originalTitle: ' ', countries: [' '], genres: [' '], ratings: [{ source: 'IMDb', score: ' ' }], duration: ' ' })
    }
    await route.fulfill({ json })
  })
  await page.goto('/')
  await page.locator('[data-nav-id="new-100"]').click()
  await expect(page.getByRole('heading', { name: 'Тестовый сериал', exact: true })).toBeVisible()
  await expect(page.locator('.detail-facts dd')).toHaveText([summary.years, summary.state].filter(Boolean))
  await expect(page.locator('.detail-original-title')).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Рейтинги' })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Жанры' })).toHaveCount(0)
  if (!summary.years) await expect(page.locator('.detail-facts')).toHaveCount(0)
})

test('card owns episode and voice while the player owns subtitles', async ({ page }) => {
  const requests: any[] = []
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method === 'streams') requests.push(params)
    await route.continue()
  })
  await detail(page)
  await page.locator('[data-nav-id="episode-1-2"]').click()
  await chooseTvOption(page, page.getByRole('combobox', { name: 'Озвучка', exact: true }), '2')
  await expect(page.locator('[data-nav-id="episode-1-2"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('combobox', { name: 'Субтитры', exact: true })).toHaveCount(0)
  await expect.poll(() => requests.at(-1)?.translatorId).toBe('2')
  expect(requests.at(-1)).toMatchObject({ id: '100', translatorId: '2', season: 1, episode: 2 })
  const before = requests.length
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  const subtitles = page.locator('.player').getByRole('combobox', { name: 'Субтитры', exact: true })
  await chooseTvOption(page, subtitles, 'ru')
  await expect.poll(() => page.locator('video').evaluate(element => element.textTracks[0]?.mode)).toBe('showing')
  expect(requests).toHaveLength(before)
  await expect(page.locator('.player').getByRole('combobox', { name: /Озвучка|Сезон|Серия/ })).toHaveCount(0)
  await expect(subtitles).toHaveAttribute('data-value', 'ru')
})

test('late subtitle metadata cannot overwrite a newer episode and a failed source can retry', async ({ page }) => {
  let release!: () => void
  let requested!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { requested = resolve })
  let fail = true
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'streams') return route.continue()
    if (params.episode === 1) {
      const response = await route.fetch(), json = await response.json()
      json.result.subtitles = [{ id: 'old', label: 'Старые субтитры', url: 'https://subtitle.example.test/test.vtt' }]
      requested(); await gate
      await route.fulfill({ json }).catch(() => {})
    } else if (fail) {
      await route.fulfill({ json: { returnValue: false, errorCode: 'NETWORK_ERROR', errorText: 'Нет связи с источником', retryable: true } })
    } else await route.continue()
  })
  await detail(page); await started
  await page.locator('[data-nav-id="episode-1-2"]').click()
  await expect(page.getByRole('button', { name: 'Повторить загрузку видео' })).toBeVisible()
  release(); fail = false
  await page.getByRole('button', { name: 'Повторить загрузку видео' }).click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.getByRole('combobox', { name: 'Субтитры', exact: true }).click()
  await expect(page.getByRole('option', { name: 'Русские', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Старые субтитры' })).toHaveCount(0)
})

test('starting another episode replaces the one series resume point', async ({ page, request }) => {
  await detail(page)
  await page.locator('[data-nav-id="episode-1-2"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).currentTime = 35; (video as HTMLVideoElement).pause() })
  await page.locator('.player-stage').focus(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect.poll(async () => Object.values((await (await request.get(backend + '/api/test/state')).json()).localProgress).map((item: any) => item.episode)).toEqual([2])
  await page.locator('[data-nav-id="episode-1-1"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await expect(page.getByRole('dialog', { name: 'Продолжить просмотр?' })).toHaveCount(0)
})

test('opening and closing another dialog cancels an in-flight Watch intent', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method === 'streams') await gate
    await route.continue()
  })
  await detail(page)
  await page.locator('[data-nav-id="detail-play"]').click()
  await page.locator('[data-nav-id="detail-bookmark"]').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  release()
  await expect(page.getByRole('combobox', { name: 'Озвучка', exact: true })).toBeEnabled()
  await expect(page.locator('.player')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('an explicit episode zero remains selectable and reaches the player', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    if (method !== 'details') return route.continue()
    const response = await route.fetch(), json = await response.json()
    json.result.episodes.unshift({ season: 1, episode: 0, title: 'Спецвыпуск' })
    await route.fulfill({ json })
  })
  await detail(page)
  await page.locator('[data-nav-id="episode-1-0"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.player-heading')).toContainText('Серия 0')
  await expect(page.getByRole('dialog', { name: 'Продолжить просмотр?' })).toHaveCount(0)
})

test('long detail metadata wraps inside the content area without horizontal scrolling', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'details') return route.continue()
    const response = await route.fetch(), json = await response.json()
    Object.assign(json.result, { originalTitle: 'LongTitle'.repeat(35), countries: ['ДлинноеНазвание'.repeat(25)], genres: ['ДлинныйЖанр'.repeat(25)] })
    await route.fulfill({ json })
  })
  await page.goto('/')
  await page.locator('[data-nav-id="new-200"]').click()
  await expect(page.locator('.detail-facts')).toBeVisible()
  for (const width of [1920, 1100]) {
    await page.setViewportSize({ width, height: 1080 })
    const overflow = await page.locator('.content-area').evaluate(element => element.scrollWidth - element.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
})
