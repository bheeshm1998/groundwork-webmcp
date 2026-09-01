import { expect, test } from '@playwright/test';

test.describe('Groundwork manual flow', () => {
  test('builds, edits, undoes, and shares the sample workspace', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:4173',
    });
    await page.goto('/');
    await expect(page.getByText('What location decision are you trying to make?')).toBeVisible();
    await page.getByTestId('load-sample').click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Change office or sample' })).toBeEnabled({
      timeout: 20_000,
    });
    await expect(page.getByText('Manual workspace history')).toBeVisible();

    const bikeInput = page.getByLabel(/Minutes for 25-minute bicycle area/u);
    await bikeInput.fill('30');
    await bikeInput.press('Enter');
    await expect(page.getByText('stale', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Recalculate' }).click();
    await expect(page.getByText('fresh', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(page.getByText(/Undid the most recent workspace change/u)).toBeVisible();
    await expect(page.getByLabel(/Minutes for 25-minute bicycle area/u)).toHaveValue('25');

    await page.getByRole('button', { name: 'Share workspace' }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(sharedUrl).toContain('#w=');
    await page.goto(sharedUrl);
    await expect(page.getByText('1 Market Street, San Francisco')).toBeVisible({ timeout: 20_000 });
  });

  test('works without WebMCP support', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Manual mode')).toBeVisible();
    await page.getByTestId('load-sample').click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 20_000 });
  });
});
