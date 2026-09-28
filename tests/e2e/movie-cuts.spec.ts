import { test, expect } from '@playwright/test'

test('Continue keeps the chosen director cut and the voice picker checks exactly one variant', async ({ page, request }) => {
  await request.post('http://127.0.0.1:5174/api/test/reset')
  await page.addInitScript(() => localStorage.setItem('rezka.preferences', JSON.stringify({ quality: 'max', translatorId: '56~0~0~1', subtitleId: '', autoNext: true })))
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    const item = { id: '200', url: 'https://hdrezka-home.tv/films/200-test.html', title: 'Две версии фильма', type: 'movie' }
    let result
    if (method === 'continueWatching') result = { items: [{ ...item, progress: { id: '200', providerTranslatorId: '56', position: null, completed: false } }], page: 1, hasMore: false }
    else if (method === 'details') result = { ...item, description: '', episodes: [], selectedTranslatorId: params.translatorId || '56', translators: [{ id: '56', name: 'Дубляж' }, { id: '56~0~0~1', name: 'Дубляж (реж. версия)' }] }
    else if (method === 'progress') result = { ...params, position: params.translatorId === '56~0~0~1' ? 42 : 10, duration: 120, completed: false, positionSource: 'local' }
    else return route.continue()
    await route.fulfill({ json: { returnValue: true, result } })
  })
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await page.locator('[data-nav-id="continue-200"]').click()
  const voice = page.getByRole('combobox', { name: 'Озвучка', exact: true })
  await expect(voice).toHaveAttribute('data-value', '56~0~0~1')
  await voice.click()
  await expect(page.getByRole('option', { selected: true })).toHaveCount(1)
  await expect(page.getByRole('option', { selected: true })).toHaveText(/реж\. версия/)
  await page.keyboard.press('Escape')
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect(page.getByRole('dialog', { name: 'Продолжить просмотр?' })).toContainText('00:42')
})
