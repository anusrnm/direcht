const { test, expect } = require('@playwright/test');

async function openApp(page) {
  await page.route('https://unpkg.com/**', (route) => route.abort());
  await page.route('https://cdnjs.cloudflare.com/**', (route) => route.abort());
  await page.addInitScript(() => {
    class MockConnection {
      constructor(peerId) {
        this.peer = peerId;
        this.open = false;
        this.handlers = {};
        this.sent = [];
      }

      on(event, handler) {
        this.handlers[event] = handler;
      }

      emit(event, data) {
        if (event === 'open') this.open = true;
        if (event === 'close') this.open = false;
        this.handlers[event]?.(data);
      }

      send(data) {
        this.sent.push(data);
      }

      close() {
        this.emit('close');
      }
    }

    class MockPeer {
      constructor() {
        this.open = false;
        this.destroyed = false;
        this.handlers = {};
        this.reconnectCalls = 0;
        this.lastConnection = null;
        window.__mockPeer = this;
        setTimeout(() => {
          this.open = true;
          this.emit('open', 'local-peer-id');
        }, 0);
      }

      on(event, handler) {
        this.handlers[event] = handler;
      }

      emit(event, data) {
        this.handlers[event]?.(data);
      }

      connect(peerId) {
        this.lastConnection = new MockConnection(peerId);
        return this.lastConnection;
      }

      reconnect() {
        this.reconnectCalls += 1;
      }
    }

    window.Peer = MockPeer;
    window.QRCode = class {
      constructor(container) {
        container.textContent = 'QR';
      }
    };
    window.Html5Qrcode = class {
      start() { return Promise.resolve(); }
      stop() { return Promise.resolve(); }
    };
    window.lucide = { createIcons() {} };
  });
  await page.goto('/index.html');
  await expect(page.locator('#myId')).toHaveValue('local-peer-id');
}

async function connect(page) {
  await page.locator('#peerId').fill('remote-peer-id');
  await page.locator('#toggleConnBtn').click();
  await expect(page.locator('#connStatus')).toHaveText('Connecting...');
  await page.evaluate(() => window.__mockPeer.lastConnection.emit('open'));
  await expect(page.locator('#connStatus')).toHaveText('Connected');
}

test.describe('Direcht chat', () => {
  test('starts ready with merged connection controls', async ({ page }) => {
    await openApp(page);

    await expect(page).toHaveTitle('Direcht');
    await expect(page.locator('#chatHeading')).toHaveText('Chat & File Transfer');
    await expect(page.locator('#peerId')).toBeVisible();
    await expect(page.locator('#scanQRBtn')).toBeVisible();
    await expect(page.locator('#toggleConnBtn')).toHaveText('Connect');
    await expect(page.locator('#msgInput')).toBeDisabled();
    await expect(page.locator('#chatArea')).toHaveAttribute('data-state', 'idle');
  });

  test('connects, shows typing, exchanges messages, and transfers a file', async ({ page }) => {
    await openApp(page);
    await connect(page);

    await expect(page.locator('#msgInput')).toBeEnabled();
    await expect(page.locator('#fileBtn')).toBeEnabled();
    await page.evaluate(() => {
      const connection = window.__mockPeer.lastConnection;
      connection.emit('data', { type: 'username', name: 'Remote User' });
      connection.emit('data', { type: 'typing' });
    });
    await expect(page.locator('#typingName')).toHaveText('Remote User');
    await expect(page.locator('#typingIndicator')).toBeVisible();

    await page.locator('#msgInput').fill('Hello from the browser');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.msg.sent')).toContainText('Hello from the browser');
    await expect.poll(() => page.evaluate(() => window.__mockPeer.lastConnection.sent.length)).toBe(3);

    await page.evaluate(() => {
      const connection = window.__mockPeer.lastConnection;
      connection.emit('data', { type: 'message', id: 'message-1', text: 'Hello back' });
      connection.emit('data', {
        type: 'file-meta',
        transferId: 'file-1',
        name: 'note.txt',
        size: 3,
        mimeType: 'text/plain',
      });
      connection.emit('data', {
        type: 'file-chunk',
        transferId: 'file-1',
        offset: 0,
        chunk: new TextEncoder().encode('hey').buffer,
      });
    });
    await expect(page.locator('.msg.received').filter({ hasText: 'Hello back' })).toBeVisible();
    await expect(page.locator('#messages a[download="note.txt"]')).toBeVisible();
  });

  test('explicit disconnect does not reconnect through queued signaling events', async ({ page }) => {
    await openApp(page);
    await connect(page);

    await page.locator('#toggleConnBtn').click();
    await expect(page.locator('#connStatus')).toHaveText('Disconnected');
    const reconnectCalls = await page.evaluate(() => {
      window.__mockPeer.emit('disconnected');
      window.__mockPeer.emit('close');
      return window.__mockPeer.reconnectCalls;
    });
    await page.waitForTimeout(1200);
    await expect.poll(() => page.evaluate(() => window.__mockPeer.reconnectCalls)).toBe(reconnectCalls);
    await expect(page.locator('#toggleConnBtn')).toHaveText('Connect');
  });

  test('opens and closes QR and clear-history dialogs', async ({ page }) => {
    await openApp(page);
    await connect(page);

    await page.locator('#scanQRBtn').click();
    await expect(page.locator('#qrModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#qrModal')).toBeHidden();

    await page.locator('#clearHistoryBtn').click();
    await expect(page.locator('#clearHistoryModal')).toBeVisible();
    await page.locator('#cancelClearBtn').click();
    await expect(page.locator('#clearHistoryModal')).toBeHidden();
  });

  test('keeps the chat beside Your ID on desktop and stacks on mobile', async ({ page }) => {
    await openApp(page);
    const identity = page.locator('.identity-card');
    const chat = page.locator('.chat-card');
    const desktopIdentity = await identity.boundingBox();
    const desktopChat = await chat.boundingBox();
    expect(desktopChat.x).toBeGreaterThan(desktopIdentity.x);

    await page.setViewportSize({ width: 480, height: 900 });
    const mobileIdentity = await identity.boundingBox();
    const mobileChat = await chat.boundingBox();
    expect(Math.abs(mobileChat.x - mobileIdentity.x)).toBeLessThanOrEqual(2);
    expect(mobileChat.y).toBeGreaterThan(mobileIdentity.y);
  });
});
