/**
 * NestJS Logger Adapter — Bridge Pino to NestJS LoggerService interface
 */
import type { LoggerService } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';

/**
 * Adapter to use Pino logger with NestJS.
 * Maps NestJS log methods to Pino levels.
 */
export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  /**
   * NestJS log() → Pino info()
   */
  log(message: string, context?: string): void {
    if (context) {
      this.logger.info({ context }, message);
    } else {
      this.logger.info(message);
    }
  }

  /**
   * NestJS error() → Pino error()
   */
  error(message: string, trace?: string, context?: string): void {
    if (context) {
      this.logger.error({ context, trace }, message);
    } else if (trace) {
      this.logger.error({ trace }, message);
    } else {
      this.logger.error(message);
    }
  }

  /**
   * NestJS warn() → Pino warn()
   */
  warn(message: string, context?: string): void {
    if (context) {
      this.logger.warn({ context }, message);
    } else {
      this.logger.warn(message);
    }
  }

  /**
   * NestJS debug() → Pino debug()
   */
  debug(message: string, context?: string): void {
    if (context) {
      this.logger.debug({ context }, message);
    } else {
      this.logger.debug(message);
    }
  }

  /**
   * NestJS verbose() → Pino trace()
   */
  verbose(message: string, context?: string): void {
    if (context) {
      this.logger.trace({ context }, message);
    } else {
      this.logger.trace(message);
    }
  }
}
