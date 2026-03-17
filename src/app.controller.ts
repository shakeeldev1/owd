import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(@Res() res: Response) {
    res.format({
      'text/html': () => res.send('<h1>Hello World! API is running</h1>'),
      'application/json': () => res.json({ message: this.appService.getHello() }),
    });
  }
}