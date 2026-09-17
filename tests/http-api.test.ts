import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHttpServer } from '../src/http-api.js';

describe('Fastify HTTP API Server', () => {
  const TEST_KEY = 'test-secret-key-12345';
  const app = createHttpServer();

  beforeAll(async () => {
    process.env['SMARTRELAY_HTTP_API_KEY'] = TEST_KEY;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests to /v1/health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { detail: string };
    expect(body.detail).toContain('Missing Authorization header');
  });

  it('rejects invalid authorization format', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { authorization: 'Basic 12345' },
    });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { detail: string };
    expect(body.detail).toContain('Invalid Authorization header format');
  });

  it('rejects incorrect API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { detail: string };
    expect(body.detail).toContain('Invalid API key');
  });

  it('allows authenticated requests to /v1/health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { authorization: `Bearer ${TEST_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      status: string;
      service: string;
      runners_loaded: number;
    };
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('smartrelay-http');
    expect(body.runners_loaded).toBeGreaterThan(0);
  });

  it('allows authenticated requests to /v1/runners', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/runners',
      headers: { authorization: `Bearer ${TEST_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Array<{ runner_id: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('dispatches tool calls via POST /v1/tools/:toolName', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tools/smartrelay_status',
      headers: { authorization: `Bearer ${TEST_KEY}` },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { configured: boolean; status: string };
    expect(body.configured).toBe(true);
    expect(body.status).toBe('healthy');
  });

  it('handles model switching via POST /v1/tools/smartrelay_switch_model', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tools/smartrelay_switch_model',
      headers: { authorization: `Bearer ${TEST_KEY}` },
      payload: { model: 'auto' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Switched to 'auto' mode");
  });

  it('validates missing required arguments for smartrelay_audit_security', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tools/smartrelay_audit_security',
      headers: { authorization: `Bearer ${TEST_KEY}` },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain('Missing required argument: code');
  });

  it('validates missing required arguments for smartrelay_audit_file_security', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tools/smartrelay_audit_file_security',
      headers: { authorization: `Bearer ${TEST_KEY}` },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain('Missing required argument: file_path');
  });

  it('returns 400 for unknown tool calls', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tools/non_existent_tool',
      headers: { authorization: `Bearer ${TEST_KEY}` },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain('Unknown tool');
  });
});
