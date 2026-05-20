import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  /**
   * CORS Configuration...
   * Allow frontend from Vercel and local development
   */
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'https://oud-xi.vercel.app',
    'http://oudalzubarah.com',
    'https://oudalzubarah.com',
    'https://www.oudalzubarah.com',
    'http://www.oudalzubarah.com',
  ];

  const frontendUrl = configService.get<string>('FRONTEND_URL');
  const frontendUrls = configService.get<string>('FRONTEND_URLS');

  if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
    allowedOrigins.push(frontendUrl);
  }

  if (frontendUrls) {
    frontendUrls
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
      .forEach((url) => {
        if (!allowedOrigins.includes(url)) {
          allowedOrigins.push(url);
        }
      });
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Allow non-browser clients (no Origin header).
      if (!origin) {
        callback(null, true);
        return;
      }

      // Allow primary production domain and subdomains on http/https.
      try {
        const parsed = new URL(origin);
        const isAllowedProtocol = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        const isAllowedDomain =
          parsed.hostname === 'oudalzubarah.com' || parsed.hostname.endsWith('.oudalzubarah.com');

        if (isAllowedProtocol && isAllowedDomain) {
          callback(null, true);
          return;
        }
      } catch {
        // Fall back to explicit allow-list check below.
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Accept-Language',
      'Origin',
    ],
    optionsSuccessStatus: 204,
  });

  // Extra defensive CORS middleware: ensure preflight and simple requests
  // to critical endpoints (like /upload) always receive the required CORS headers
  // even if upstream proxies or other middleware interfere.
  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      try {
        const parsed = new URL(origin);
        const hostname = parsed.hostname;
        const isAllowedDomain = hostname === 'oudalzubarah.com' || hostname.endsWith('.oudalzubarah.com');
        if (isAllowedDomain || (allowedOrigins && allowedOrigins.includes(origin))) {
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Access-Control-Allow-Credentials', 'true');
          res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Accept-Language, Origin');
          res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
        }
      } catch (err) {
        // ignore invalid origin values
      }
    }

    if (req.method === 'OPTIONS') {
      // respond to preflight immediately
      res.sendStatus(204);
      return;
    }

    next();
  });

  // Global API prefix
  // app.setGlobalPrefix('api');

  // Static uploads folder
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  const port = configService.get<number>('PORT') || 3000;

  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Server running on http://localhost:${port}`);
}

bootstrap();