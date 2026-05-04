import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Request, Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger: Logger = new Logger('ExceptionFilter');

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest<Request>();
        const response = ctx.getResponse<Response>();
        const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

        this.logger.error('Unhandled Exception', {
            timestamp: new Date().toISOString(),
            path: request.url,
            error: exception instanceof Error ? exception.message : exception,
            stack: exception instanceof Error ? exception.stack : undefined,
        });

        response.status(status).json({message: "Internal status error"});
    }
}