import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app-error';

/**
 * 统一错误响应：{ code, message, details? }
 * - AppError：业务错误，按自带 httpStatus 返回；
 * - HttpException（含 ValidationPipe 抛出的）：语义化转换；
 * - 其他：500，且不泄漏内部信息。
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      response.status(exception.httpStatus).json({
        code: exception.code,
        message: exception.message,
        details: exception.details,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const rawMessage =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);
      response.status(status).json({
        code: 'HTTP_ERROR',
        message: Array.isArray(rawMessage) ? rawMessage.join('; ') : rawMessage,
      });
      return;
    }

    this.logger.error('未处理异常', exception instanceof Error ? exception.stack : String(exception));
    response.status(500).json({ code: 'INTERNAL', message: '服务内部错误' });
  }
}
