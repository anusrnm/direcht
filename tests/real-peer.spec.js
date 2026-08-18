const { test, expect } = require('@playwright/test');

const runRealPeerTests = process.env.REAL_PEER_TESTS === '1';

test.describe('Direcht real PeerJS connection', () => {
  test.skip(!runRealPeerTests, 'Set REAL_PEER_TESTS=1 to run real PeerJS tests.');
  test.describe.configure({ timeout: 60000 });

  async function openRealApp(page) {
    await page.route('https://unpkg.com/**', (route) => {
      if (route.request().url().includes('/peerjs@')) route.continue();
      else route.abort();
    });
    await page.route('https://cdnjs.cloudflare.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      window.QRCode = class {
        constructor() {}
      };
      window.Html5Qrcode = class {
        start() { return Promise.resolve(); }
        stop() { return Promise.resolve(); }
      };
      window.lucide = { createIcons() {} };
    });
    await page.goto('/index.html');
    await expect(page.locator('#myId')).toBeVisible({ timeout: 30000 });
    return page.locator('#myId').inputValue();
  }

  async function connectPages(pageA, pageB, peerIdB) {
    await pageA.locator('#peerId').fill(peerIdB);
    await pageA.locator('#toggleConnBtn').click();
    await expect(pageA.locator('#connStatus')).toHaveText('Connected', { timeout: 30000 });
    await expect(pageB.locator('#connStatus')).toHaveText('Connected', { timeout: 30000 });
  }

  test('connects two real browser peers and exchanges a message', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await Promise.all([openRealApp(pageA), openRealApp(pageB)]);
      const peerIdB = await pageB.locator('#myId').inputValue();
      await connectPages(pageA, pageB, peerIdB);

      await pageA.locator('#msgInput').fill('Real PeerJS message');
      await pageA.locator('#sendBtn').click();
      await expect(pageB.locator('.msg.received')).toContainText('Real PeerJS message', { timeout: 10000 });
    } finally {
      await Promise.all([contextA.close(), contextB.close()]);
    }
  });

  test('manually reconnects real peers after the remote side disconnects', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await Promise.all([openRealApp(pageA), openRealApp(pageB)]);
      const peerIdB = await pageB.locator('#myId').inputValue();
      await connectPages(pageA, pageB, peerIdB);

      await pageB.locator('#toggleConnBtn').click();
      await expect(pageB.locator('#connStatus')).toHaveText('Disconnected');

      if (await pageA.locator('#connStatus').textContent() === 'Connected') {
        await pageA.locator('#toggleConnBtn').click();
      }
      await expect(pageA.locator('#connStatus')).toHaveText('Disconnected', { timeout: 10000 });
      await pageA.locator('#peerId').fill(peerIdB);
      await pageA.locator('#toggleConnBtn').click();
      await expect(pageA.locator('#connStatus')).toHaveText('Connected', { timeout: 30000 });
      await expect(pageB.locator('#connStatus')).toHaveText('Connected', { timeout: 30000 });
    } finally {
      await Promise.all([contextA.close(), contextB.close()]);
    }
  });
});
