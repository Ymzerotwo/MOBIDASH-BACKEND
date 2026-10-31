import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiKeyAuth } from '../../src/middleware/apiKey.middleware';

describe('Middleware: MobiDash API Key & Domain Auth', () => {
  let mockContext: any;
  let mockNext: any;
  const VALID_KEY = 'mobidash_secret_test_key_xyz123';
  const VALID_ORIGIN = 'http://localhost:3000';

  beforeEach(() => {
    vi.clearAllMocks();

    mockNext = vi.fn();

    mockContext = {
      req: {
        method: 'GET',
        path: '/api/phones',
        header: vi.fn(),
        url: 'http://localhost/api/phones',
      },
      env: {
        MOBIDASH_API_KEY: VALID_KEY,
        ALLOWED_ORIGINS: 'http://localhost:3000,https://mobidash.com',
      },
      set: vi.fn(),
      get: vi.fn((key: string) => {
        if (key === 'requestId') return 'req-test-123';
        return undefined;
      }),
      json: vi.fn((data, status) => ({ status, data })),
    };
  });

  it('should bypass OPTIONS preflight requests', async () => {
    mockContext.req.method = 'OPTIONS';

    await apiKeyAuth(mockContext, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockContext.json).not.toHaveBeenCalled();
  });

  it('should return obscure 404 NOT_FOUND if origin is not allowed in production', async () => {
    mockContext.req.url = 'https://api.mobidash.com/api/phones';
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'origin') return 'https://malicious-hacker-site.com';
      if (name.toLowerCase() === 'x-api-key') return VALID_KEY;
      return undefined;
    });

    const response: any = await apiKeyAuth(mockContext, mockNext);

    expect(response.status).toBe(404);
    expect(response.data.slug).toBe('NOT_FOUND');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return obscure 404 NOT_FOUND if no API Key is provided', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'origin') return VALID_ORIGIN;
      return undefined;
    });

    const response: any = await apiKeyAuth(mockContext, mockNext);

    expect(response.status).toBe(404);
    expect(response.data.slug).toBe('NOT_FOUND');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return obscure 404 NOT_FOUND if key does not match', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'origin') return VALID_ORIGIN;
      if (name.toLowerCase() === 'x-api-key') return 'wrong_api_key_guess';
      return undefined;
    });

    const response: any = await apiKeyAuth(mockContext, mockNext);

    expect(response.status).toBe(404);
    expect(response.data.slug).toBe('NOT_FOUND');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should authorize successfully when valid key and allowed origin are provided via x-api-key', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'origin') return VALID_ORIGIN;
      if (name.toLowerCase() === 'x-api-key') return VALID_KEY;
      return undefined;
    });

    await apiKeyAuth(mockContext, mockNext);

    expect(mockContext.set).toHaveBeenCalledWith('apiKeyDomain', VALID_ORIGIN);
    expect(mockContext.set).toHaveBeenCalledWith('isApiKeyAuthenticated', true);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should authorize successfully when valid key is provided via Authorization: Bearer', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'origin') return VALID_ORIGIN;
      if (name.toLowerCase() === 'authorization') return `Bearer ${VALID_KEY}`;
      return undefined;
    });

    await apiKeyAuth(mockContext, mockNext);

    expect(mockContext.set).toHaveBeenCalledWith('apiKeyDomain', VALID_ORIGIN);
    expect(mockContext.set).toHaveBeenCalledWith('isApiKeyAuthenticated', true);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should trim surrounding whitespace from API key before comparison', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'origin') return VALID_ORIGIN;
      if (name.toLowerCase() === 'x-api-key') return `   ${VALID_KEY}   `;
      return undefined;
    });

    await apiKeyAuth(mockContext, mockNext);

    expect(mockContext.set).toHaveBeenCalledWith('apiKeyDomain', VALID_ORIGIN);
    expect(mockContext.set).toHaveBeenCalledWith('isApiKeyAuthenticated', true);
    expect(mockNext).toHaveBeenCalled();
  });
});
