import { expect, test } from '@playwright/test';

test.describe('Groundwork manual flow', () => {
  test('builds, edits, undoes, and shares the sample workspace', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:4173',
    });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Find a place that fits your everyday life.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Plan in San Francisco' }).click();
    await expect(page).toHaveURL(/\/app\?city=sf$/u);
    await expect(page.getByRole('heading', { name: 'Where do you need to go?' })).toBeVisible();
    await page.getByTestId('load-sample').click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Change' })).toBeEnabled({
      timeout: 20_000,
    });

    const bikeInput = page.getByLabel(/Minutes for 25-minute bicycle area/u);
    await bikeInput.fill('30');
    await bikeInput.press('Enter');
    await expect(page.getByRole('button', { name: 'Update matching areas' })).toBeVisible();
    await page.getByRole('button', { name: 'Update matching areas' }).click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Workspace' }).click();
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(page.getByText(/Undid the most recent workspace change/u)).toBeVisible();
    await expect(page.getByLabel(/Minutes for 25-minute bicycle area/u)).toHaveValue('25');

    await page.getByRole('button', { name: 'Share plan' }).click();
    await expect(page.getByText('Share link copied')).toBeVisible();
    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(sharedUrl).toContain('#w=');
    await page.goto(sharedUrl);
    await expect(page.getByText('San Francisco City Hall', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('selects Hyderabad on the homepage and completes a local analysis', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await page.getByRole('button', { name: /Hyderabad India/u }).click();
    await page.getByRole('link', { name: 'Plan in Hyderabad' }).click();

    await expect(page).toHaveURL(/\/app\?city=hyderabad$/u);
    await expect(page.getByText('Search Hyderabad')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Interactive Hyderabad analysis map')).toBeVisible();
    await page.getByTestId('load-sample').click();
    await expect(page.getByText('Ramanthapur', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/of Hyderabad fits your current priorities/u)).toBeVisible();
  });

  test('works without WebMCP support', async ({ page }) => {
    await page.goto('/app?city=sf');
    await page.getByRole('button', { name: 'Workspace' }).click();
    await expect(page.getByText(/using Groundwork manually/u)).toBeVisible();
    await page.getByRole('button', { name: 'Close workspace options' }).click();
    await page.getByTestId('load-sample').click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 20_000 });
  });
});
