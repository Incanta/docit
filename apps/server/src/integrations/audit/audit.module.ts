import { Global, Module } from '@nestjs/common';
import { AUDIT_SERVICE } from './audit.service';
import { DbAuditService } from './db-audit.service';
import { AuditController } from './audit.controller';

@Global()
@Module({
  controllers: [AuditController],
  providers: [
    DbAuditService,
    {
      provide: AUDIT_SERVICE,
      useExisting: DbAuditService,
    },
  ],
  exports: [AUDIT_SERVICE],
})
export class AuditModule {}
