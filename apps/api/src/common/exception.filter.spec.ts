import { BadRequestException, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppExceptionFilter } from './exception.filter';
import { AppError } from './app-error';

function createHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const response = { status };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AppExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AppError 按自带状态码与业务 code 返回', () => {
    const filter = new AppExceptionFilter();
    const { host, status, json } = createHost();
    filter.catch(AppError.notFound('信笺不存在'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ code: 'NOT_FOUND', message: '信笺不存在', details: [] });
  });

  it('ValidationPipe 的 HttpException 合并消息', () => {
    const filter = new AppExceptionFilter();
    const { host, status, json } = createHost();
    filter.catch(new BadRequestException({ message: ['email must be a string', 'too long'] }), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'HTTP_ERROR',
      message: 'email must be a string; too long',
    });
  });

  it('未知异常返回 500 且不泄漏内部信息', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const filter = new AppExceptionFilter();
    const { host, status, json } = createHost();
    filter.catch(new Error('数据库连接串泄露风险'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ code: 'INTERNAL', message: '服务内部错误' });
  });
});
