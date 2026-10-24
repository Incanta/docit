import { DbAuditService } from './db-audit.service';
import { AUDIT_CONTEXT_KEY } from '../../common/middlewares/audit-context.middleware';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';

const WS = '01a16f0c-c4b1-7e73-8209-5257ca89f488';
const USER = '01a16f0c-c4ad-7906-a583-95c9f3daac18';

function build(ctx: Record<string, any> | undefined) {
  const store = new Map<string, any>();
  if (ctx) store.set(AUDIT_CONTEXT_KEY, ctx);
  const cls = {
    isActive: () => true,
    get: (k: string) => store.get(k),
    set: (k: string, v: any) => store.set(k, v),
  };
  const auditRepo = { insert: jest.fn().mockResolvedValue(undefined) };
  const service = new DbAuditService(cls as any, auditRepo as any, {} as any);
  return { service, auditRepo };
}

describe('DbAuditService', () => {
  it('writes the event with the request context', () => {
    const { service, auditRepo } = build({
      workspaceId: WS,
      actorId: USER,
      actorType: 'user',
      ipAddress: '::ffff:10.0.0.1',
      userAgent: 'jest',
    });

    service.log({
      event: AuditEvent.COMMENT_CREATED,
      resourceType: AuditResource.COMMENT,
      resourceId: USER,
    });

    const [row] = auditRepo.insert.mock.calls[0][0];
    expect(row).toMatchObject({
      workspaceId: WS,
      actorId: USER,
      actorType: 'user',
      ipAddress: '10.0.0.1',
      userAgent: 'jest',
      resourceId: USER,
    });
  });

  it('skips events without a workspace', () => {
    const { service, auditRepo } = build(undefined);
    service.log({
      event: AuditEvent.COMMENT_CREATED,
      resourceType: AuditResource.COMMENT,
    });
    expect(auditRepo.insert).not.toHaveBeenCalled();
  });

  it('treats the user as actor for unauthenticated user events', () => {
    const { service, auditRepo } = build({
      workspaceId: WS,
      actorId: null,
      actorType: 'user',
      ipAddress: null,
      userAgent: null,
    });
    service.log({
      event: AuditEvent.USER_LOGIN,
      resourceType: AuditResource.USER,
      resourceId: USER,
    });
    const [row] = auditRepo.insert.mock.calls[0][0];
    expect(row.actorId).toBe(USER);
    expect(row.actorType).toBe('user');
  });

  it('moves non-uuid resource ids into metadata', () => {
    const { service, auditRepo } = build({
      workspaceId: WS,
      actorId: null,
      actorType: 'system',
      ipAddress: 'not-an-ip',
      userAgent: null,
    });
    service.log({
      event: AuditEvent.WORKSPACE_UPDATED,
      resourceType: AuditResource.WORKSPACE,
      resourceId: 'abc',
    });
    const [row] = auditRepo.insert.mock.calls[0][0];
    expect(row.resourceId).toBeNull();
    expect(row.metadata).toEqual({ resourceId: 'abc' });
    expect(row.ipAddress).toBeNull();
    expect(row.actorType).toBe('system');
  });
});
