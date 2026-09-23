import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppInfoService {
  constructor(private readonly config: ConfigService) {}

  getInfo() {
    return {
      appName: this.config.get<string>('APP_NAME') || 'Zomaal',
      version: this.config.get<string>('APP_VERSION') || '1.0.0',
      privacyPolicyUrl:
        this.config.get<string>('PRIVACY_POLICY_URL') || null,
      aboutUrl: this.config.get<string>('ABOUT_APP_URL') || null,
      termsOfServiceUrl:
        this.config.get<string>('TERMS_OF_SERVICE_URL') || null,
      supportEmail: this.config.get<string>('SUPPORT_EMAIL') || null,
    };
  }
}
