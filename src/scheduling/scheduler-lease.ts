export interface SchedulerLease {
    acquire(name: string, ttlMs: number): Promise<boolean>;
    renew(name: string, ttlMs: number): Promise<boolean>;
    release(name: string): Promise<void>;
}
