import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from './app-error';

/**
 * 开发期身份传递：请求头 x-user-id / x-admin-id。
 * 临时约定，正式登录态与鉴权在 Sprint 1.3 接入（见 README「开发期约定」）。
 */
function readIdentityHeader(ctx: ExecutionContext, header: string, label: string): string {
  const request = ctx.switchToHttp().getRequest<Request>();
  const raw = request.headers[header];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.trim().length === 0) {
    throw AppError.validation(
      [{ field: header, message: `开发期缺少${label}标识请求头 ${header}` }],
      '未登录',
    );
  }
  return value;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  readIdentityHeader(ctx, 'x-user-id', '用户'),
);

export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  readIdentityHeader(ctx, 'x-admin-id', '管理员'),
);
