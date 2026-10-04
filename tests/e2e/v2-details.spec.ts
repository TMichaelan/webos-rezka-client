import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { chooseTvOption } from './tv-select'

const backend = 'http://127.0.0.1:5174'
const gladiatorUrl = 'https://hdrezka-home.tv/films/action/757-gladiator-2000.html'
const walkingDeadUrl = 'https://hdrezka-home.tv/series/horror/76-hodyachie-mertvecy-2010-latest.html'
const pittUrl = 'https://hdrezka-home.tv/series/drama/76523-bolnica-pitt-2025-latest.html'
const gladiatorTwoUrl = 'https://hdrezka-home.tv/films/action/69851-gladiator-2-2024.html'
const trailerUrl = 'https://www.youtube.com/embed/FVx-Yp5vtbI?autoplay=1'

const image = (color: string, width = 300, height = 450) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill="${color}" d="M0 0h${width}v${height}H0z"/></svg>`)
const poster = image('#6f5138')
const photo = image('#3c5362', 360, 480)

const gladiator = { id: '757', url: gladiatorUrl, title: 'Гладиатор', type: 'movie' as const, poster, meta: '2000 · Фильм', rating: '8.5' }
const walkingDead = { id: '76', url: walkingDeadUrl, title: 'Ходячие мертвецы', type: 'series' as const, poster: image('#3f493c'), meta: '2010–2022 · Сериал' }
const pitt = { id: '76523', url: pittUrl, title: 'Больница Питт', type: 'series' as const, poster: image('#38596b'), meta: '2025–… · Сериал', status: 'Выходит' }
const gladiatorTwo = { id: '69851', url: gladiatorTwoUrl, title: 'Гладиатор II', type: 'movie' as const, poster: image('#725445'), meta: '2024 · Фильм', rating: '6.7' }

const actors = [
  ['7293', 'Хоакин Феникс', 'hoakin-feniks'], ['4960', 'Конни Нильсен', 'konni-nilsen'], ['11392', 'Оливер Рид', 'oliver-rid'],
  ['11393', 'Ричард Харрис', 'richard-harris'], ['8452', 'Дерек Джекоби', 'derek-dzhekobi'], ['8636', 'Джимон Хонсу', 'dzhimon-honsu'],
  ['1649', 'Дэвид Скофилд', 'devid-skofild'], ['8380', 'Джон Шрэпнел', 'dzhon-shrepnel'], ['4901', 'Томас Арана', 'tomas-arana'],
  ['11051', 'Ральф Мёллер', 'ralf-myoller'], ['11052', 'Спенсер Трит Кларк', 'spenser-trit-klark'], ['11053', 'Дэвид Хеммингс', 'devid-hemmings'],
  ['11054', 'Томми Флэнаган', 'tommi-flenagan'], ['11055', 'Свен-Оле Торсен', 'sven-ole-torsen'], ['716', 'Рассел Кроу', 'rassel-krou'],
].map(([id, name, slug]) => ({ id, name, url: `https://hdrezka-home.tv/person/${id}-${slug}/`, photo }))
const ridleyScott = { id: '3722', name: 'Ридли Скотт', url: 'https://hdrezka-home.tv/person/3722-ridli-skott/', photo }
const russellDirector = { ...actors.at(-1)!, url: 'https://hdrezka-home.tv/person/716-rassel-krou-director/' }
const svenActor = actors.find(item => item.id === '11055')!

let nextFilmId = 8000
const film = (slug: string, title: string, year: string) => { const id = String(nextFilmId++); return { id, url: `https://hdrezka-home.tv/films/drama/${id}-${slug}.html`, title, type: 'movie' as const, poster: image('#4d5864'), meta: `${year} · Фильм` } }
const filmography = [
  gladiator,
  film('a-beautiful-mind', 'Игры разума', '2001'),
  film('master-and-commander', 'Хозяин морей', '2003'),
  film('cinderella-man', 'Нокдаун', '2005'),
  film('three-ten-to-yuma', 'Поезд на Юму', '2007'),
  film('american-gangster', 'Гангстер', '2007'),
  film('body-of-lies', 'Совокупность лжи', '2008'),
  film('state-of-play', 'Большая игра', '2009'),
  film('robin-hood', 'Робин Гуд', '2010'),
  film('les-miserables', 'Отверженные', '2012'),
  film('noah', 'Ной', '2014'),
  film('the-nice-guys', 'Славные парни', '2016'),
]
const produced = [film('poker-face', 'Покерфейс', '2022'), film('land-of-bad', 'Территория зла', '2024')]

const parts = [
  { ...gladiator, order: 1, current: true, year: '2000' },
  { ...gladiatorTwo, order: 2, year: '2024' },
]

const movieDetails = (item: typeof gladiator | ReturnType<typeof film>) => ({
  ...item,
  description: `${item.title}: локальное описание для V2 E2E.`,
  translators: [{ id: '1', name: 'Дубляж' }],
  selectedTranslatorId: '1',
  episodes: [],
  year: item.meta.slice(0, 4),
  countries: ['США'],
  genres: ['Драма'],
  duration: '155 мин',
})

const gladiatorDetails = {
  ...movieDetails(gladiator),
  originalTitle: 'Gladiator',
  releaseDate: '1 мая 2000 года',
  countries: ['США', 'Великобритания'],
  ageRating: '18+',
  genres: ['Боевик', 'Драма', 'Приключения'],
  ratings: [{ source: 'IMDb', score: '8.5', votes: '1 700 000' }, { source: 'Кинопоиск', score: '8.6', votes: '620 000' }],
  rankings: [{ name: '250 лучших фильмов', place: 36, url: 'https://hdrezka-home.tv/top-250/' }, { name: 'Лучшие исторические фильмы', place: 4 }],
  trailerAvailable: true,
  directors: [ridleyScott, russellDirector],
  actors,
  franchiseTitle: 'Гладиатор — все части',
  parts,
  schedule: [],
}

const pittDetails = {
  ...pitt,
  meta: undefined,
  status: undefined,
  description: 'Повседневная работа врачей травматологического отделения Питтсбурга.',
  translators: [{ id: '1', name: 'LostFilm' }, { id: '2', name: 'Оригинал' }],
  selectedTranslatorId: '1',
  episodes: [
    { season: 2, episode: 1, title: 'Эпизод 1' },
    { season: 2, episode: 2, title: 'Эпизод 2' },
    { season: 1, episode: 1, title: 'Эпизод 1' },
  ],
  originalTitle: 'The Pitt',
  year: '2025',
  genres: ['Драма'],
  duration: '50 мин',
  ratings: [{ source: 'IMDb', score: '8.9', votes: '95 000' }],
  rankings: [{ name: 'Лучшие сериалы о врачах', place: 1 }],
  trailerAvailable: true,
  directors: [],
  actors: [],
  franchiseTitle: 'Больница Питт — все части',
  parts: [{ ...pitt, order: 1, current: true, year: '2025' }, { ...gladiatorTwo, order: 2, year: '2024' }],
  schedule: [
    { season: 2, episode: 5, title: 'Будущее 5', originalTitle: 'Future 5', airDate: '30 октября 2026', relative: 'через 26 дней', state: 'upcoming' },
    { season: 2, episode: 1, title: 'Будущее 1', originalTitle: 'Future 1', airDate: '2 октября 2026', relative: 'через 5 дней', state: 'upcoming' },
    { season: 2, episode: 4, title: 'Будущее 4', originalTitle: 'Future 4', airDate: '23 октября 2026', relative: 'через 19 дней', state: 'upcoming' },
    { season: 2, episode: 2, title: 'Будущее 2', originalTitle: 'Future 2', airDate: '9 октября 2026', relative: 'через 12 дней', state: 'upcoming' },
    { season: 2, episode: 3, title: 'Будущее 3', originalTitle: 'Future 3', airDate: '16 октября 2026', relative: 'через 15 дней', state: 'upcoming' },
    { season: 1, episode: 2, title: 'Вышла 2', originalTitle: 'Aired 2', airDate: '6 февраля 2025', state: 'aired' },
    { season: 1, episode: 5, title: 'Вышла 5', originalTitle: 'Aired 5', airDate: '27 февраля 2025', state: 'aired' },
    { season: 1, episode: 1, title: 'Вышла 1', originalTitle: 'Aired 1', airDate: '30 января 2025', state: 'aired' },
    { season: 1, episode: 4, title: 'Вышла 4', originalTitle: 'Aired 4', airDate: '20 февраля 2025', state: 'aired' },
    { season: 1, episode: 3, title: 'Вышла 3', originalTitle: 'Aired 3', airDate: '13 февраля 2025', state: 'aired' },
  ],
}

const walkingDeadDetails = {
  ...walkingDead,
  description: 'Группа выживших ищет безопасное место после катастрофы.',
  translators: [{ id: '1', name: 'Fox' }],
  selectedTranslatorId: '1',
  episodes: [{ season: 11, episode: 24, title: 'Покойся с миром' }],
  originalTitle: 'The Walking Dead',
  year: '2010',
  genres: ['Ужасы', 'Драма'],
  duration: '43 мин',
  rankings: [{ name: 'Лучшие сериалы о выживании', place: 3 }],
  trailerAvailable: true,
  directors: [], actors: [], parts: [], schedule: [
    { season: 11, episode: 24, title: 'Покойся с миром', originalTitle: 'Rest in Peace', airDate: '21 ноября 2022', state: 'aired' },
    { season: 1, episode: 1, title: 'Дни минувшие', originalTitle: 'Days Gone Bye', airDate: '31 октября 2010', state: 'aired' },
  ],
}

const russellCrowe = {
  id: '716',
  name: 'Рассел Кроу',
  originalName: 'Russell Crowe',
  url: 'https://hdrezka-home.tv/person/716-rassel-krou/',
  photo,
  facts: [{ label: 'Дата рождения', value: '7 апреля 1964' }, { label: 'Место рождения', value: 'Веллингтон, Новая Зеландия' }],
  careers: [
    { role: 'Актёр', summary: '52 фильма и сериала', items: filmography },
    { role: 'Продюсер', summary: '8 проектов', items: produced },
  ],
}
const svenOle = {
  id: svenActor.id,
  name: svenActor.name,
  originalName: 'Sven-Ole Thorsen',
  url: svenActor.url,
  photo,
  facts: [{ label: 'Дата рождения', value: '24 сентября 1944' }, { label: 'Место рождения', value: 'Копенгаген, Дания' }],
  careers: [{ role: 'Актёр', summary: '24 фильма', items: filmography }],
}

const detailsByUrl = new Map<string, object>([
  ...filmography.map(item => [item.url, movieDetails(item)] as const),
  ...produced.map(item => [item.url, movieDetails(item)] as const),
  [gladiatorUrl, gladiatorDetails],
  [gladiatorTwoUrl, { ...movieDetails(gladiatorTwo), originalTitle: 'Gladiator II', franchiseTitle: 'Гладиатор — все части', parts }],
  [walkingDeadUrl, walkingDeadDetails],
  [pittUrl, pittDetails],
])

const fulfill = (route: Route, result: unknown) => route.fulfill({ json: { returnValue: true, result } })

async function installV2Api(page: Page) {
  await page.route('**/api/rpc', async route => {
    const { method, params = {} } = route.request().postDataJSON()
    if (method === 'catalog') return fulfill(route, { items: [gladiator, walkingDead, pitt], page: params.page || 1, hasMore: false })
    if (method === 'details' && detailsByUrl.has(params.url)) return fulfill(route, detailsByUrl.get(params.url))
    if (method === 'person' && [russellCrowe.url, russellDirector.url].includes(params.url)) return fulfill(route, russellCrowe)
    if (method === 'person' && params.url === svenOle.url) return fulfill(route, svenOle)
    if (method === 'trailer') {
      if (params.id === gladiator.id && params.url === gladiatorUrl) return fulfill(route, { url: trailerUrl })
      return route.fulfill({ json: { returnValue: false, errorCode: 'INVALID_INPUT', errorText: 'Unexpected trailer request' } })
    }
    await route.fallback()
  })
}

async function openNew(page: Page, id: string, title: string) {
  await page.goto('/')
  const card = page.locator(`[data-nav-id="new-${id}"]`)
  await expect(card).toBeVisible()
  await card.click()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.locator('.title-detail')).toHaveAttribute('aria-busy', 'false')
}

async function horizontalScroll(card: Locator, moveToEnd = false) {
  return card.evaluate((node, shouldMove) => {
    let rail = node.parentElement
    while (rail && rail !== document.body && rail.scrollWidth <= rail.clientWidth + 1) rail = rail.parentElement
    if (!rail || rail === document.body) throw new Error('Card has no horizontally scrollable rail')
    if (shouldMove) rail.scrollLeft = rail.scrollWidth
    return Math.round(rail.scrollLeft)
  }, moveToEnd)
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${backend}/api/test/reset`)
  await installV2Api(page)
})

test('movie detail renders supplemental metadata and restores a selected franchise part', async ({ page }) => {
  await openNew(page, gladiator.id, gladiator.title)

  const info = page.locator('.detail-info')
  await expect(info.getByText('250 лучших фильмов', { exact: true })).toBeVisible()
  await expect(info.getByText(/№\s*36/)).toBeVisible()
  await expect(page.getByRole('list', { name: 'Рейтинги' })).toContainText('IMDb')
  await expect(page.getByRole('list', { name: 'Рейтинги' })).toContainText('8.5')
  await expect(page.locator('.detail-actions').getByRole('button', { name: /трейлер/i })).toBeVisible()

  const people = page.getByRole('region', { name: 'Персоны', exact: true })
  await expect(people.getByRole('button', { name: /Ридли Скотт/ })).toBeVisible()
  await expect(people.getByRole('button', { name: /Хоакин Феникс/ })).toBeVisible()
  await expect(people.getByRole('button', { name: /Рассел Кроу/ })).toHaveCount(1)
  await expect(people.getByText('Режиссёр · Актёр', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Режиссёры', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: /В ролях/i })).toHaveCount(0)
  const allParts = page.getByRole('region', { name: 'Гладиатор — все части', exact: true })
  const sequel = allParts.getByRole('button', { name: /Гладиатор II/ })
  await expect(sequel).toBeVisible()
  await expect(page.getByRole('region', { name: /Расписание/i })).toHaveCount(0)
  await expect.poll(() => page.locator('.detail-parts').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px')
  await expect.poll(() => page.locator('.detail-people').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px')

  await sequel.focus()
  await sequel.click()
  await expect(page.getByRole('heading', { name: 'Гладиатор II', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Гладиатор', exact: true })).toBeVisible()
  await expect(sequel).toBeFocused()
})

test('series schedule defaults to its first season and keeps episode rows informational', async ({ page }) => {
  await openNew(page, pitt.id, pitt.title)

  const schedule = page.getByRole('region', { name: /Расписание/i })
  const season = schedule.getByRole('combobox', { name: /Сезон/i })
  await expect(season).toHaveAttribute('data-value', '2')
  const episode = page.locator('[data-nav-id="episode-2-2"]')
  await episode.focus()
  await page.keyboard.press('ArrowDown')
  await expect(season).toBeFocused()
  const rows = schedule.locator('.schedule-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.locator('.schedule-title strong')).toHaveText(['Будущее 1', 'Будущее 2', 'Будущее 3'])
  await expect(schedule.getByText('через 5 дней', { exact: true })).toBeVisible()
  await expect(schedule.getByText('Будущее 4', { exact: true })).toHaveCount(0)
  const toggle = schedule.getByRole('button', { name: 'Развернуть', exact: true })
  await expect(toggle).toBeVisible()
  await expect(schedule.locator('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).toHaveCount(2)
  await toggle.click()
  await expect(rows).toHaveCount(5)
  await expect(rows.locator('.schedule-title strong')).toHaveText(['Будущее 1', 'Будущее 2', 'Будущее 3', 'Будущее 4', 'Будущее 5'])
  await expect.poll(() => page.locator('.detail-episodes').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px')
  await expect.poll(() => page.locator('.detail-schedule').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px')
  await expect.poll(() => page.locator('.detail-parts').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px')

  await chooseTvOption(page, season, 1)
  await expect(rows).toHaveCount(3)
  await expect(rows.locator('.schedule-title strong')).toHaveText(['Вышла 5', 'Вышла 4', 'Вышла 3'])
  await expect(schedule.getByText('Вышла 2', { exact: true })).toHaveCount(0)
  await expect(schedule.getByRole('button', { name: 'Развернуть', exact: true })).toBeVisible()
  await expect(schedule.getByText('Будущее 1', { exact: true })).toHaveCount(0)
  await schedule.getByRole('button', { name: 'Развернуть', exact: true }).click()
  await expect(rows).toHaveCount(5)
  await expect(schedule.getByRole('button', { name: 'Свернуть', exact: true })).toBeVisible()
  await episode.click()
  await chooseTvOption(page, page.getByRole('combobox', { name: 'Озвучка', exact: true }), '2')
  await expect(season).toHaveAttribute('data-value', '1')
  await expect(episode).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.detail-facts dd')).toContainText(['2025–…', 'Выходит'])

  const sequel = page.getByRole('region', { name: 'Больница Питт — все части', exact: true }).getByRole('button', { name: /Гладиатор II/ })
  await sequel.click()
  await expect(page.getByRole('heading', { name: 'Гладиатор II', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: pitt.title, exact: true })).toBeVisible()
  await expect(episode).toHaveAttribute('aria-pressed', 'true')
  await expect(season).toHaveAttribute('data-value', '1')
  await expect(rows).toHaveCount(5)
  await expect(schedule.getByRole('button', { name: 'Свернуть', exact: true })).toBeVisible()
  await expect(page.locator('.detail-facts dd')).toContainText(['2025–…', 'Выходит'])
  await expect(sequel).toBeFocused()

  await page.keyboard.press('Escape')
  await page.locator(`[data-nav-id="new-${walkingDead.id}"]`).click()
  const nextSchedule = page.getByRole('region', { name: /Расписание/i })
  await expect(nextSchedule.getByRole('combobox', { name: /Сезон/i })).toHaveAttribute('data-value', '11')
  await expect(nextSchedule.getByText('Покойся с миром', { exact: true })).toBeVisible()
  await expect(nextSchedule.getByRole('button', { name: /Развернуть|Свернуть/ })).toHaveCount(0)
})

test('single-season schedule reveals its collapse toggle when reached from episodes', async ({ page }) => {
  const schedule = [5, 2, 4, 1, 3].map(episode => ({ season: 11, episode, title: `Вышла ${episode}`, originalTitle: `Aired ${episode}`, airDate: `${episode} ноября 2022`, state: 'aired' }))
  await page.route('**/api/rpc', async route => {
    const { method, params = {} } = route.request().postDataJSON()
    if (method === 'details' && params.url === walkingDeadUrl) return fulfill(route, { ...walkingDeadDetails, schedule })
    await route.fallback()
  })
  await openNew(page, walkingDead.id, walkingDead.title)

  const region = page.getByRole('region', { name: /Расписание/i })
  await expect(region.locator('.schedule-title strong')).toHaveText(['Вышла 5', 'Вышла 4', 'Вышла 3'])
  const episode = page.locator('[data-nav-id="episode-11-24"]')
  await episode.focus()
  await page.keyboard.press('ArrowDown')
  const toggle = region.getByRole('button', { name: 'Развернуть', exact: true })
  await expect(toggle).toBeFocused()
  await expect.poll(() => toggle.evaluate(element => {
    const control = element.getBoundingClientRect(), viewport = element.closest('.content-area')!.getBoundingClientRect()
    return control.top >= viewport.top && control.bottom <= viewport.bottom
  })).toBe(true)
})

test('person filmography is grouped and Back restores both card focus and horizontal scroll', async ({ page }) => {
  await openNew(page, gladiator.id, gladiator.title)

  const people = page.getByRole('region', { name: 'Персоны', exact: true })
  const personCards = people.getByRole('button')
  const actor = people.getByRole('button', { name: /Свен-Оле Торсен/ })
  await expect(actor).toBeVisible()
  await personCards.first().focus()
  for (let index = 1; index < await personCards.count(); index++) await page.keyboard.press('ArrowRight')
  await expect(actor).toBeFocused()
  await expect.poll(() => horizontalScroll(actor)).toBeGreaterThan(500)
  const castScroll = await horizontalScroll(actor)
  expect(castScroll).toBeGreaterThan(0)
  await actor.click()

  await expect(page.getByRole('heading', { name: 'Свен-Оле Торсен', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Свен-Оле Торсен', exact: true })).toBeVisible()
  await expect(page.getByText('Sven-Ole Thorsen', { exact: true })).toBeVisible()
  await expect(page.getByText('24 сентября 1944', { exact: true })).toBeVisible()
  await expect(page.getByText('Копенгаген, Дания', { exact: true })).toBeVisible()
  const acting = page.getByRole('region', { name: /Актёр/i })
  await expect(acting).toContainText('24 фильма')

  const filmCard = acting.getByRole('button', { name: /Славные парни/ })
  const filmCards = acting.getByRole('button')
  await filmCards.first().focus()
  for (let index = 1; index < await filmCards.count(); index++) await page.keyboard.press('ArrowRight')
  await expect(filmCard).toBeFocused()
  await expect.poll(() => horizontalScroll(filmCard)).toBeGreaterThan(500)
  const filmographyScroll = await horizontalScroll(filmCard)
  expect(filmographyScroll).toBeGreaterThan(0)
  await filmCard.click()
  await expect(page.getByRole('heading', { name: 'Славные парни', exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Свен-Оле Торсен', exact: true })).toBeVisible()
  await expect(filmCard).toBeFocused()
  await expect.poll(() => horizontalScroll(filmCard)).toBeGreaterThan(500)
  await expect.poll(() => filmCard.evaluate(element => { const card = element.getBoundingClientRect(), rail = element.closest('.poster-row')!.getBoundingClientRect(); return card.left >= rail.left && card.right <= rail.right })).toBe(true)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Гладиатор', exact: true })).toBeVisible()
  await expect(actor).toBeFocused()
  await expect.poll(() => horizontalScroll(actor)).toBeGreaterThan(500)
  await expect.poll(() => actor.evaluate(element => { const card = element.getBoundingClientRect(), rail = element.closest('.poster-row')!.getBoundingClientRect(); return card.left >= rail.left && card.right <= rail.right })).toBe(true)
})

test('trailer opens the returned iframe full-screen and Back restores the trailer action', async ({ page }) => {
  await openNew(page, gladiator.id, gladiator.title)

  const trigger = page.locator('.detail-actions').getByRole('button', { name: /трейлер/i })
  await expect(trigger).toBeVisible()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: /трейлер/i })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: /(?:Трейлер.*Гладиатор|Гладиатор.*трейлер)/i })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Закрыть трейлер/i })).toBeVisible()
  const start = dialog.getByRole('button', { name: /Воспроизвести трейлер/i })
  await expect(start).toBeFocused()
  await expect(dialog.locator('iframe')).toHaveCount(0)
  await start.click()
  await expect(dialog.locator('iframe')).toHaveAttribute('src', trailerUrl)
  await expect(dialog.locator('iframe')).toHaveAttribute('title', /трейлер/i)
  await expect.poll(() => dialog.locator('iframe').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
  await expect(dialog.getByRole('button', { name: /Закрыть трейлер/i })).toBeFocused()
  const viewport = page.viewportSize()!
  const box = await dialog.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(viewport.width * .9)
  expect(box!.height).toBeGreaterThanOrEqual(viewport.height * .9)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('a pending Watch intent blocks Trailer and cannot mount both playback surfaces', async ({ page }) => {
  let release!: () => void
  let markStarted!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method === 'streams') { markStarted(); await gate }
    await route.fallback()
  })
  await openNew(page, gladiator.id, gladiator.title)

  await page.locator('[data-nav-id="detail-play"]').click()
  await started
  const trailer = page.locator('[data-nav-id="detail-trailer"]')
  await expect(trailer).toBeDisabled()
  await trailer.evaluate((element: HTMLButtonElement) => element.click())
  await expect(page.getByRole('dialog', { name: /трейлер/i })).toHaveCount(0)

  release()
  await expect(page.locator('.player')).toBeVisible()
  await expect(page.locator('.trailer-backdrop')).toHaveCount(0)
})
