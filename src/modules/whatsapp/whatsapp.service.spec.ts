import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from './whatsapp.service';

type SettingsDocChain = {
  select: () => { lean: () => Promise<{ whatsappEnabled?: boolean; whatsappNumber?: string } | null> };
};

describe('WhatsAppService', () => {
  const originalFetch = global.fetch;

  const buildService = (options?: {
    config?: Record<string, string>;
    settings?: { whatsappEnabled?: boolean; whatsappNumber?: string } | null;
  }) => {
    const configValues = {
      MESSAGING_API_URL: 'https://custom1.waghl.com/send-message',
      MESSAGING_API_KEY: 'test-key',
      MESSAGING_SENDER: 'AKOYA',
      MESSAGING_DEFAULT_NUMBER: '+97433689955',
      MESSAGING_ENABLED: 'true',
      MESSAGING_TIMEOUT_MS: '12000',
      ...(options?.config || {}),
    };

    const configService = {
      get: jest.fn((key: string, fallback?: string) => {
        const value = configValues[key as keyof typeof configValues];
        return value ?? fallback;
      }),
    } as unknown as ConfigService;

    const settingsModel = {
      findOne: jest.fn(
        (): SettingsDocChain => ({
          select: () => ({
            lean: async () => options?.settings ?? { whatsappEnabled: true, whatsappNumber: '+97433689955' },
          }),
        }),
      ),
    };

    const service = new WhatsAppService(configService, settingsModel as any);
    return { service, settingsModel };
  };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('skips send when WhatsApp disabled in settings', async () => {
    const { service } = buildService({ settings: { whatsappEnabled: false, whatsappNumber: '+97433689955' } });

    global.fetch = jest.fn() as any;

    const result = await service.sendMessage('+97455001122', 'Hello');
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid phone payloads', async () => {
    const { service } = buildService();

    global.fetch = jest.fn() as any;

    const result = await service.sendMessage('abc', 'Hello');
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retries once on provider 5xx then succeeds', async () => {
    const { service } = buildService();

    const first = {
      ok: false,
      status: 500,
      text: async () => 'server error',
      headers: new Headers({ 'content-type': 'text/plain' }),
    } as unknown as Response;

    const second = {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response;

    const fetchMock = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    global.fetch = fetchMock as any;

    const result = await service.sendMessage('+97455001122', 'Order update', { mirrorToAdmin: false });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstPayload).toMatchObject({
      api_key: 'test-key',
      sender: '97433689955',
      number: '97455001122',
      message: 'Order update',
    });
  });

  it('preserves an alphanumeric sender id in the payload', async () => {
    const { service } = buildService({
      config: {
        MESSAGING_SENDER: 'AKOYA-01',
        MESSAGING_DEFAULT_NUMBER: '',
      },
      settings: { whatsappEnabled: true, whatsappNumber: '' },
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
    } as unknown as Response);
    global.fetch = fetchMock as any;

    const result = await service.sendMessage('+97455001122', 'Order update', { mirrorToAdmin: false });

    expect(result).toBe(true);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.sender).toBe('AKOYA-01');
  });

  it('accepts WHATSAPP env aliases for api key and sender', async () => {
    const { service } = buildService({
      config: {
        MESSAGING_API_KEY: '',
        MESSAGING_SENDER: '',
        MESSAGING_DEFAULT_NUMBER: '',
        WHATSAPP_API_KEY: 'alias-key',
        WHATSAPP_SENDER: 'ALIAS01',
        WHATSAPP_NUMBER: '',
      },
      settings: { whatsappEnabled: true, whatsappNumber: '' },
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
    } as unknown as Response);
    global.fetch = fetchMock as any;

    const result = await service.sendMessage('+97455001122', 'Alias test', { mirrorToAdmin: false });

    expect(result).toBe(true);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.api_key).toBe('alias-key');
    expect(payload.sender).toBe('ALIAS01');
  });

  it('sends Arabic order confirmation text', async () => {
    const { service } = buildService({ settings: { whatsappEnabled: true, whatsappNumber: '+97455001122' } });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
    } as unknown as Response);
    global.fetch = fetchMock as any;

    const result = await service.sendOrderConfirmation('+97455001122', 'أحمد', 'ORD-202604-1234', 150);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.message).toContain('فاتورة طلبك');
    expect(payload.message).toContain('ريال قطري');
  });
});
