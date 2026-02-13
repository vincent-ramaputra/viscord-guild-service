import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from "express";

@Controller('health')
export class HealthController {

    @Get()
    healthCheck(@Res() res: Response) {
        return res.status(HttpStatus.OK).send();
    }
}
