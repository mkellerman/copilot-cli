import type { Response } from 'express';

export async function forwardStreamResponse(
  upstream: Awaited<ReturnType<typeof fetch>>,
  res: Response,
  abortController: AbortController
): Promise<void> {
  if (!upstream.ok || !upstream.body) {
    const errorText = await safeReadText(upstream);
    res.status(upstream.status || 502).json({
      error: {
        message: errorText || 'GitHub Copilot streaming request failed',
        type: 'upstream_error',
        code: upstream.status || 502
      }
    });
    return;
  }

  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  const reader = upstream.body.getReader();
  let completed = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      if (value && value.length) {
        res.write(Buffer.from(value));
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      const message = error instanceof Error ? error.message : 'Unknown streaming error';
      res.write(`data: {"error": {"message": "${message.replace(/"/g, '\\"')}", "type": "stream_error"}}\n\n`);
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => {});
    } else {
      reader.releaseLock();
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}

export async function forwardJsonResponse(
  upstream: Awaited<ReturnType<typeof fetch>>,
  res: Response,
  fallbackModel: string
): Promise<void> {
  const status = upstream.status || 502;
  const text = await safeReadText(upstream);

  if (!upstream.ok) {
    if (text) {
      try {
        const parsed = JSON.parse(text);
        res.status(status).json(parsed);
        return;
      } catch {
        // fall through to wrapped error envelope
      }
    }

    res.status(status).json({
      error: {
        message: text || `GitHub Copilot API error (${status})`,
        type: 'upstream_error',
        code: status
      }
    });
    return;
  }

  if (!text) {
    res.status(status).json({ object: 'chat.completion', model: fallbackModel, choices: [] });
    return;
  }

  try {
    const payload = JSON.parse(text);
    payload.object = payload.object ?? 'chat.completion';
    payload.model = payload.model ?? fallbackModel;
    payload.created = payload.created ?? Math.floor(Date.now() / 1000);
    res.status(status).json(payload);
  } catch {
    res.status(502).json({
      error: {
        message: 'Failed to parse upstream response',
        type: 'parse_error'
      }
    });
  }
}

export async function safeReadText(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

