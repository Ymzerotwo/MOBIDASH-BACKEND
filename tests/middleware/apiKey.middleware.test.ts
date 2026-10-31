import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiKeyAuth } from '../../src/middleware/apiKey.middleware';

describe('Middleware: MobiDash API Key Auth', () => {
  let mockContext: any;
  let mockNext: any;
  const VALID_KEY = 'mobidash_secret_test_key_xyz123';

  beforeEach(() => {
    vi.clearAllMocks();

    mockNext = vi.fn();

    mockContext = {
      req: {
        header: vi.fn(),
        url: 'http://localhost/api/test',
      },
      env: {
        API_KEY: VALID_KEY,
      },
      set: vi.fn(),
      get: vi.fn((key: string) => {
        if (key === 'requestId') return 'req-test-123';
        return undefined;
      }),
      json: vi.fn((data, status) => ({ status, data })),
    };
  });

  it('should return 401 API_KEY_MISSING if no API Key is provided', async () => {
    mockContext.req.header.mockReturnValue(undefined);

    const response: any = await apiKeyAuth(mockContext, mockNext);

    expect(response.status).toBe(401);
    expect(response.data.slug).toBe('API_KEY_MISSING');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 500 API_KEY_NOT_CONFIGURED if server env lacks API_KEY binding (Fail-Closed)', async () => {
    mockContext.env = {}; // No API_KEY configured on server
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'x-api-key') return VALID_KEY;
      return undefined;
    });

    const response: any = await apiKeyAuth(mockContext, mockNext);

    expect(response.status).toBe(500);
    expect(response.data.slug).toBe('API_KEY_NOT_CONFIGURED');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 INVALID_API_KEY if key does not match', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'x-api-key') return 'wrong_api_key';
      return undefined;
    });

    const response: any = await apiKeyAuth(mockContext, mockNext);

    expect(response.status).toBe(401);
    expect(response.data.slug).toBe('INVALID_API_KEY');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should authorize successfully when valid key is provided via x-api-key', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'x-api-key') return VALID_KEY;
      return undefined;
    });

    await apiKeyAuth(mockContext, mockNext);

    expect(mockContext.set).toHaveBeenCalledWith('apiKeyDomain', 'authorized');
    expect(mockContext.set).toHaveBeenCalledWith('isApiKeyAuthenticated', true);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should authorize successfully when valid key is provided via Authorization: Bearer', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'authorization') return `Bearer ${VALID_KEY}`;
      return undefined;
    });

    await apiKeyAuth(mockContext, mockNext);

    expect(mockContext.set).toHaveBeenCalledWith('apiKeyDomain', 'authorized');
    expect(mockContext.set).toHaveBeenCalledWith('isApiKeyAuthenticated', true);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should trim surrounding whitespace from API key before comparison', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'x-api-key') return `   ${VALID_KEY}   `;
      return undefined;
    });

    await apiKeyAuth(mockContext, mockNext);

    expect(mockContext.set).toHaveBeenCalledWith('apiKeyDomain', 'authorized');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should fallback to MOBIDASH_API_KEY if API_KEY is not set', async () => {
    mockContext.env = {
      MOBIDASH_API_KEY: 'custom_mobi_key_456',
    };
    mockContext.req.header.mockImplementation((name: string) => {
      if (name.toLowerCase() === 'x-api-key') return 'custom_mobi_key_456';
      return undefined;
    });

    await apiKeyAuth(mockContext, mockNext);

    expect(mockContext.set).toHaveBeenCalledWith('apiKeyDomain', 'authorized');
    expect(mockNext).toHaveBeenCalled();
  });
});
