import { ModelCatalog } from '../model-catalog.js';

export interface ModelCatalogServiceOptions {
  intervalMs?: number;
  staleAfterMs?: number;
  verify?: boolean;
  concurrency?: number;
  getAuthContext: () => Promise<{ profileId: string; token: string } | null>;
}

export class ModelCatalogService {
  private static instance: ModelCatalogService | undefined;

  static getInstance(): ModelCatalogService {
    if (!ModelCatalogService.instance) {
      ModelCatalogService.instance = new ModelCatalogService();
    }
    return ModelCatalogService.instance;
  }

  private readonly catalog = ModelCatalog.getInstance();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  start(options: ModelCatalogServiceOptions): void {
    if (this.running) {
      this.stop();
    }

    const {
      intervalMs = 5 * 60 * 1000,
      staleAfterMs = intervalMs,
      verify = true,
      concurrency,
      getAuthContext
    } = options;

    const tick = async () => {
      try {
        const context = await getAuthContext();
        if (!context) {
          return;
        }

        const { profileId, token } = context;
        await this.catalog.ensureFreshProfile(profileId, token, {
          verify,
          staleAfterMs,
          source: 'scheduled',
          concurrency
        });
      } catch (error) {
        if (process.env.DEBUG) {
          console.error('[model-catalog] scheduled refresh failed:', error);
        }
      }
    };

    this.running = true;
    void tick();
    this.timer = setInterval(() => {
      void tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
