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
      WHATSAPP_API_URL: 'https://custom1.waghl.com/send-message',
      WHATSAPP_API_KEY: 'test-key',
      WHATSAPP_SENDER: 'AKOYA',
      WHATSAPP_DEFAULT_NUMBER: '+97433689955',
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_TIMEOUT_MS: '12000',
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
    expect(result).toBe(true);
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

    const result = await service.sendMessage('+97455001122', 'Order update');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstPayload).toMatchObject({
      api_key: 'test-key',
      sender: 'AKOYA',
      number: '97455001122',
      message: 'Order update',
    });
  });
});
