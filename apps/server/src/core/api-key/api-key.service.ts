import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyRepo } from '@docmost/db/repos/api-key/api-key.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { ApiKey, User, Workspace } from '@docmost/db/types/entity.types';
import { TokenService } from '../auth/services/token.service';
import { JwtApiKeyPayload } from '../auth/dto/jwt-payload';
import { isUserDisabled } from '../../common/helpers';
import { UserRole } from '../../common/helpers/types/permission';
import { ALL_API_KEY_SCOPES, isValidScope } from './api-key-scopes';

const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export type ApiKeyAuthResult = {
  user: User;
  workspace: Workspace;
  apiKey: { id: string; scopes: string[] | null };
};

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  private readonly lastUsedWrites = new Map<string, number>();

  constructor(
    private readonly apiKeyRepo: ApiKeyRepo,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly tokenService: TokenService,
  ) {}

  isAdmin(user: User): boolean {
    return user.role === UserRole.ADMIN || user.role === UserRole.OWNER;
  }

  isRestrictedToAdmins(workspace: Workspace): boolean {
    return (workspace.settings as any)?.api?.restrictToAdmins === true;
  }

  assertCanUseApiKeys(user: User, workspace: Workspace) {
    if (this.isRestrictedToAdmins(workspace) && !this.isAdmin(user)) {
      throw new ForbiddenException(
        'API keys are restricted to workspace admins',
      );
    }
  }

  normalizeScopes(scopes: string[]): string[] {
    const unique = [...new Set(scopes)];
    const invalid = unique.filter((s) => !isValidScope(s));
    if (invalid.length) {
      throw new BadRequestException(`Unknown scopes: ${invalid.join(', ')}`);
    }
    if (unique.length === 0) {
      throw new BadRequestException('Select at least one scope');
    }
    // Keep catalog order for stable display.
    return ALL_API_KEY_SCOPES.filter((s) => unique.includes(s));
  }

  async create(opts: {
    user: User;
    workspace: Workspace;
    name: string;
    scopes: string[];
    expiresAt?: Date | null;
  }): Promise<{ apiKey: ApiKey; token: string }> {
    const { user, workspace } = opts;
    this.assertCanUseApiKeys(user, workspace);

    if (opts.expiresAt && opts.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Expiration must be in the future');
    }

    const apiKey = await this.apiKeyRepo.insert({
      name: opts.name,
      scopes: this.normalizeScopes(opts.scopes),
      creatorId: user.id,
      workspaceId: workspace.id,
      expiresAt: opts.expiresAt ?? null,
    });

    const expiresIn = opts.expiresAt
      ? Math.max(1, Math.floor((opts.expiresAt.getTime() - Date.now()) / 1000))
      : undefined;

    const token = await this.tokenService.generateApiToken({
      apiKeyId: apiKey.id,
      user,
      workspaceId: workspace.id,
      expiresIn,
    });

    return { apiKey, token };
  }

  /** Admins see every key in the workspace; members only their own. */
  async list(
    user: User,
    workspace: Workspace,
    opts: { all?: boolean; limit: number; cursor?: string },
  ) {
    const all = opts.all && this.isAdmin(user);
    return this.apiKeyRepo.list(workspace.id, {
      creatorId: all ? undefined : user.id,
      limit: opts.limit,
      cursor: opts.cursor,
    });
  }

  async getManageable(
    apiKeyId: string,
    user: User,
    workspace: Workspace,
  ): Promise<ApiKey> {
    const apiKey = await this.apiKeyRepo.findById(apiKeyId, workspace.id);
    if (!apiKey) throw new NotFoundException('API key not found');
    if (apiKey.creatorId !== user.id && !this.isAdmin(user)) {
      throw new ForbiddenException();
    }
    return apiKey;
  }

  async rename(apiKey: ApiKey, name: string): Promise<void> {
    await this.apiKeyRepo.update(apiKey.id, apiKey.workspaceId, { name });
  }

  async revoke(apiKey: ApiKey): Promise<void> {
    await this.apiKeyRepo.softDelete(apiKey.id, apiKey.workspaceId);
  }

  /** Called by the JWT strategy for `api_key` tokens. */
  async validate(payload: JwtApiKeyPayload): Promise<ApiKeyAuthResult> {
    const apiKey = await this.apiKeyRepo.findById(
      payload.apiKeyId,
      payload.workspaceId,
    );
    if (!apiKey || apiKey.creatorId !== payload.sub) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now()) {
      throw new UnauthorizedException('API key expired');
    }

    const workspace = await this.workspaceRepo.findById(payload.workspaceId);
    if (!workspace) throw new UnauthorizedException();

    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);
    if (!user || isUserDisabled(user)) {
      throw new UnauthorizedException();
    }

    if (this.isRestrictedToAdmins(workspace) && !this.isAdmin(user)) {
      throw new UnauthorizedException(
        'API keys are restricted to workspace admins',
      );
    }

    this.recordUse(apiKey.id);

    return {
      user,
      workspace,
      apiKey: { id: apiKey.id, scopes: apiKey.scopes ?? null },
    };
  }

  private recordUse(apiKeyId: string) {
    const now = Date.now();
    const last = this.lastUsedWrites.get(apiKeyId) ?? 0;
    if (now - last < LAST_USED_WRITE_INTERVAL_MS) return;
    this.lastUsedWrites.set(apiKeyId, now);
    this.apiKeyRepo
      .touchLastUsed(apiKeyId)
      .catch((err) =>
        this.logger.warn(`Failed to update API key last use: ${err.message}`),
      );
  }
}
