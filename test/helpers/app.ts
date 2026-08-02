import { buildApp } from '../../src/api/app.js';

interface TestAppOptions {
    disableWorkers?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}) {
    if (options.disableWorkers) {
        process.env.DISABLE_WORKERS = 'true';
    } else {
        delete process.env.DISABLE_WORKERS;
    }

    const app = await buildApp();

    await app.ready();

    return app;
}
